use crate::{
    domain::nodes::*,
    infrastructure::{mihomo, vault},
};
use base64::{
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE_NO_PAD},
    Engine,
};
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Store {
    nodes: Vec<Record>,
    selected_id: Option<String>,
}
#[derive(Serialize, Deserialize)]
struct Record {
    summary: NodeSummary,
    config: serde_json::Value,
}
// 保护短时读写事务，不锁定网络请求。
static TEST_RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
struct TestSession;
impl Drop for TestSession {
    fn drop(&mut self) {
        TEST_RUNNING.store(false, std::sync::atomic::Ordering::Release);
    }
}
static STORE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
fn store_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    STORE_LOCK.lock().map_err(|_| "节点记录正忙，请重试".into())
}
fn load() -> Result<Store, String> {
    match vault::read("proxy-nodes-v1.dpapi")? {
        Some(bytes) => {
            serde_json::from_slice(&bytes).map_err(|_| "节点记录无法读取，原文件已保留".into())
        }
        None => Ok(Store::default()),
    }
}
fn save(store: &Store) -> Result<(), String> {
    vault::save(
        "proxy-nodes-v1.dpapi",
        &serde_json::to_vec(store).map_err(|_| "节点保存失败")?,
    )
}
pub fn has_nodes() -> Result<bool, String> {
    let _guard = store_lock()?;
    Ok(!load()?.nodes.is_empty())
}
pub fn read() -> Result<NodeSnapshot, String> {
    let _guard = store_lock()?;
    let store = load()?;
    Ok(NodeSnapshot {
        nodes: store.nodes.into_iter().map(|r| r.summary).collect(),
        selected_id: store.selected_id,
        runtime: ProxyRuntime {
            running: Some(TEST_RUNNING.load(std::sync::atomic::Ordering::Acquire)),
            version: Some(mihomo::VERSION.into()),
        },
    })
}
pub(crate) fn virtual_node_config() -> Result<serde_json::Value, String> {
    let _guard = store_lock()?;
    let store = load()?;
    let item = store
        .nodes
        .iter()
        .find(|n| Some(&n.summary.id) == store.selected_id.as_ref())
        .ok_or("请先选择节点")?;
    if item.summary.status != "connected" {
        return Err("请先测试所选节点".into());
    }
    Ok(native_config(item))
}
pub(crate) fn with_selected<T>(
    expected: &NodeSummary,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _guard = store_lock()?;
    let store = load()?;
    let actual = store
        .nodes
        .iter()
        .find(|n| Some(&n.summary.id) == store.selected_id.as_ref())
        .map(|n| &n.summary);
    if actual
        .map(serde_json::to_value)
        .transpose()
        .map_err(|e| e.to_string())?
        != Some(serde_json::to_value(expected).map_err(|e| e.to_string())?)
    {
        return Err("所选出口已变化，请重新检测后确认".into());
    }
    action()
}
fn record(name: String, protocol: String, config: serde_json::Value) -> Record {
    let id = format!(
        "{}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        std::process::id()
    );
    Record {
        summary: NodeSummary {
            id,
            name,
            protocol,
            region: None,
            country_code: None,
            latency: None,
            exit_ip: None,
            status: "untested".into(),
            error: None,
        },
        config,
    }
}
pub fn validate_proxy(proxy: &GeneralProxy) -> Result<(), String> {
    if !["http", "https", "socks5"].contains(&proxy.protocol.as_str()) || proxy.port == 0 {
        return Err("代理协议或端口无效".into());
    }
    if proxy.server.is_empty()
        || proxy
            .server
            .chars()
            .any(|c| c.is_whitespace() || "/?#@".contains(c))
    {
        return Err("请填写有效的服务器地址".into());
    }
    url::Host::parse(proxy.server.trim_matches(['[', ']']))
        .map_err(|_| "请填写有效的服务器地址")?;
    Ok(())
}
pub fn import_proxy(proxy: GeneralProxy) -> Result<ImportResult, String> {
    validate_proxy(&proxy)?;
    let _guard = store_lock()?;
    let mut store = load()?;
    let item = record(
        format!("{}:{}", proxy.server, proxy.port),
        proxy.protocol.clone(),
        serde_json::to_value(proxy).map_err(|_| "代理数据无效")?,
    );
    merge(&mut store, vec![item])
}
fn decode(value: &str) -> Result<String, String> {
    let bytes = STANDARD
        .decode(value)
        .or_else(|_| STANDARD_NO_PAD.decode(value))
        .or_else(|_| URL_SAFE_NO_PAD.decode(value))
        .map_err(|_| "节点链接编码无效")?;
    String::from_utf8(bytes).map_err(|_| "节点链接编码无效".into())
}
fn parse_link(link: &str) -> Result<Record, String> {
    let (protocol, _) = link.split_once("://").ok_or("暂不支持此链接格式")?;
    if !["ss", "vmess", "vless", "trojan"].contains(&protocol) {
        return Err("暂不支持此链接格式".into());
    }
    let name = if protocol == "vmess" {
        let body = decode(link.trim_start_matches("vmess://"))?;
        let value: serde_json::Value =
            serde_json::from_str(&body).map_err(|_| "节点链接内容无效")?;
        if value["add"].as_str().unwrap_or_default().is_empty()
            || value["id"].as_str().unwrap_or_default().is_empty()
        {
            return Err("节点链接缺少服务器或认证信息".into());
        }
        value["ps"].as_str().unwrap_or("VMess 节点").to_string()
    } else {
        let parsed = url::Url::parse(link).map_err(|_| "节点链接内容无效")?;
        if protocol != "ss"
            && (parsed.host_str().is_none()
                || parsed.port().is_none()
                || parsed.username().is_empty())
        {
            return Err("节点链接缺少服务器、端口或认证信息".into());
        }
        if protocol == "ss" {
            let body = link
                .trim_start_matches("ss://")
                .split('#')
                .next()
                .unwrap_or("");
            if !body.contains('@') && !decode(body)?.contains('@') {
                return Err("节点链接内容无效".into());
            }
        }
        parsed
            .fragment()
            .and_then(|fragment| {
                url::form_urlencoded::parse(
                    format!("n={}", fragment.replace('+', "%2B")).as_bytes(),
                )
                .next()
                .map(|(_, value)| value.into_owned())
            })
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| format!("{} 节点", protocol.to_uppercase()))
    };
    Ok(record(
        name,
        protocol.into(),
        serde_json::json!({"uri":link}),
    ))
}
fn parse_content(content: &str) -> Result<Vec<Record>, String> {
    parse_depth(content, 0)
}
fn parse_depth(content: &str, depth: u8) -> Result<Vec<Record>, String> {
    if depth > 2 {
        return Err("订阅内容无法识别".into());
    }
    let content = content.trim();
    if content.is_empty() {
        return Err("请粘贴订阅链接或节点链接".into());
    }
    if serde_yaml::from_str::<serde_json::Value>(content)
        .ok()
        .and_then(|v| v.get("proxies").cloned())
        .is_some()
    {
        let value: serde_json::Value =
            serde_yaml::from_str(content).map_err(|_| "订阅内容无法识别")?;
        let proxies = value["proxies"].as_array().ok_or("订阅中没有节点")?;
        let mut nodes = Vec::new();
        for proxy in proxies {
            let name = proxy["name"].as_str().ok_or("订阅节点缺少名称")?;
            let protocol = proxy["type"].as_str().ok_or("订阅节点缺少协议")?;
            if proxy["server"].as_str().unwrap_or_default().is_empty()
                || proxy["port"]
                    .as_u64()
                    .filter(|port| *port > 0 && *port <= 65535)
                    .is_none()
            {
                return Err("订阅节点的地址或端口无效".into());
            }
            nodes.push(record(name.into(), protocol.into(), proxy.clone()));
        }
        if nodes.is_empty() {
            return Err("订阅中没有节点".into());
        }
        return Ok(nodes);
    }
    if !content.contains("://") {
        return parse_depth(
            &decode(&content.split_whitespace().collect::<String>())?,
            depth + 1,
        );
    }
    content.split_whitespace().map(parse_link).collect()
}
pub fn import_links(links: String) -> Result<ImportResult, String> {
    let links = links.trim().to_owned();
    if links.len() > 1024 * 1024 {
        return Err("导入内容过大".into());
    }
    let content = if links.starts_with("https://") || links.starts_with("http://") {
        let url = url::Url::parse(links.trim()).map_err(|_| "订阅地址无效")?;
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|_| "无法创建订阅请求")?;
        // 部分订阅网关只识别旧版 Clash 客户端标识。
        // 优先协商 Mihomo 格式；格式协商不兼容时再重试一次。
        let request = |agent: &str| {
            client
                .get(url.clone())
                .header(reqwest::header::USER_AGENT, agent)
                .header(
                    reqwest::header::ACCEPT,
                    "application/yaml, text/yaml, text/plain, */*",
                )
                .send()
        };
        let response =
            request("mihomo/1.19.34").map_err(|_| "订阅获取失败，请检查网络或代理设置")?;
        let response = if matches!(response.status().as_u16(), 400 | 406) {
            request("ClashforWindows/0.20.39").map_err(|_| "订阅获取失败，请检查网络或代理设置")?
        } else {
            response
        };
        let response = response.error_for_status().map_err(|e| match e.status() {
            Some(status) => format!(
                "订阅服务器返回 HTTP {}，请检查链接是否有效",
                status.as_u16()
            ),
            None => "订阅获取失败，请检查网络或代理设置".into(),
        })?;
        let mut bytes = Vec::new();
        response
            .take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "订阅读取失败")?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err("订阅内容过大".into());
        }
        String::from_utf8(bytes).map_err(|_| "订阅内容无法识别")?
    } else {
        links
    };
    let records = parse_content(&content)?;
    let engine = mihomo::Engine::start(&records.iter().map(native_config).collect::<Vec<_>>())?;
    for i in 0..records.len() {
        engine.node(i)?;
    }
    let _guard = store_lock()?;
    let mut store = load()?;
    merge(&mut store, records)
}
fn native_config(item: &Record) -> serde_json::Value {
    if let Ok(p) = serde_json::from_value::<GeneralProxy>(item.config.clone()) {
        let mut config = serde_json::json!({"name":item.summary.id,"type":if p.protocol == "https" {"http"} else {&p.protocol},"server":p.server,"port":p.port});
        if p.protocol == "https" {
            config["tls"] = true.into();
        }
        if !p.username.is_empty() {
            config["username"] = p.username.into();
            config["password"] = p.password.into();
        }
        config
    } else {
        item.config.clone()
    }
}
fn identity(item: &Record) -> String {
    let mut value = native_config(item);
    if let Some(uri) = value["uri"].as_str() {
        if let Some(body) = uri.strip_prefix("ss://") {
            let body = body.split('#').next().unwrap_or(body);
            let (address, query) = body.split_once('?').unwrap_or((body, ""));
            let decoded = if address.contains('@') {
                address.to_owned()
            } else {
                decode(address).unwrap_or_else(|_| address.to_owned())
            };
            if let Some((auth, host)) = decoded.rsplit_once('@') {
                let auth = decode(auth).unwrap_or_else(|_| auth.to_owned());
                let auth: String = url::form_urlencoded::parse(
                    format!("a={}", auth.replace('+', "%2B")).as_bytes(),
                )
                .next()
                .map(|(_, v)| v.into_owned())
                .unwrap_or(auth);
                if let (Some((cipher, password)), Ok(endpoint)) = (
                    auth.split_once(':'),
                    url::Url::parse(&format!("http://{}", host.trim_end_matches('/'))),
                ) {
                    let mut config = serde_json::json!({"type":"ss","cipher":cipher,"password":password,"server":endpoint.host_str().unwrap_or_default().to_lowercase(),"port":endpoint.port()});
                    for (key, val) in url::form_urlencoded::parse(query.as_bytes()) {
                        config[key.as_ref()] = val.into_owned().into();
                    }
                    return config.to_string();
                }
            }
        }
        if let Some(body) = uri.strip_prefix("vmess://") {
            if let Ok(body) = decode(body) {
                if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(o) = v.as_object_mut() {
                        o.remove("ps");
                    }
                    return format!("vmess:{v}");
                }
            }
        }
        if let Ok(mut url) = url::Url::parse(uri) {
            url.set_fragment(None);
            let mut query = url
                .query_pairs()
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .collect::<Vec<_>>();
            query.sort();
            url.set_query(None);
            if !query.is_empty() {
                url.query_pairs_mut().extend_pairs(query);
            }
            return url.to_string();
        }
    }
    if let Some(object) = value.as_object_mut() {
        object.remove("name");
        if let Some(server) = object.get_mut("server") {
            if let Some(s) = server.as_str() {
                *server = s.to_lowercase().into();
            }
        }
    }
    value.to_string()
}
fn merge(store: &mut Store, records: Vec<Record>) -> Result<ImportResult, String> {
    let mut keys = std::collections::HashSet::new();
    let mut original_ids = std::collections::HashMap::new();
    store.nodes.retain(|item| {
        let key = identity(item);
        if keys.insert(key.clone()) {
            original_ids.insert(key, item.summary.id.clone());
            true
        } else {
            if store.selected_id.as_ref() == Some(&item.summary.id) {
                store.selected_id = original_ids.get(&key).cloned();
            }
            false
        }
    });
    let mut result = ImportResult {
        added: 0,
        duplicates: 0,
    };
    for item in records {
        if keys.insert(identity(&item)) {
            store.nodes.push(item);
            result.added += 1;
        } else {
            result.duplicates += 1;
        }
    }
    save(store)?;
    Ok(result)
}
pub fn select(id: String) -> Result<(), String> {
    let _guard = store_lock()?;
    let mut store = load()?;
    if !store.nodes.iter().any(|r| r.summary.id == id) {
        return Err("节点已不存在，请重新选择".into());
    }
    store.selected_id = Some(id);
    save(&store)
}
pub fn remove(id: String) -> Result<(), String> {
    let _guard = store_lock()?;
    let mut store = load()?;
    store.nodes.retain(|r| r.summary.id != id);
    if store.selected_id.as_ref() == Some(&id) {
        store.selected_id = None;
    }
    save(&store)
}
pub fn clear() -> Result<(), String> {
    let _guard = store_lock()?;
    save(&Store::default())
}
#[cfg(test)]
pub fn test() -> Result<(), String> {
    test_with_progress(|_| {})
}
#[cfg(test)]
pub fn test_with_progress(progress: impl Fn(NodeSnapshot)) -> Result<(), String> {
    test_ordered_with_progress(Vec::new(), progress)
}
pub fn test_ordered_with_progress(
    ids: Vec<String>,
    progress: impl Fn(NodeSnapshot),
) -> Result<(), String> {
    let mut store = {
        let _guard = store_lock()?;
        load()?
    };
    let ranks: std::collections::HashMap<_, _> =
        ids.iter().enumerate().map(|(i, id)| (id, i)).collect();
    store
        .nodes
        .sort_by_key(|node| ranks.get(&node.summary.id).copied().unwrap_or(usize::MAX));
    if store.nodes.is_empty() {
        return Ok(());
    }
    TEST_RUNNING
        .compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::AcqRel,
            std::sync::atomic::Ordering::Acquire,
        )
        .map_err(|_| "节点测速正在执行")?;
    let session = TestSession;
    let configs = store.nodes.iter().map(native_config).collect::<Vec<_>>();
    let engine = mihomo::Engine::start(&configs)?;
    for item in &mut store.nodes {
        item.summary.status = "queued".into();
        item.summary.error = None;
        item.summary.latency = None;
        item.summary.region = None;
        item.summary.country_code = None;
        item.summary.exit_ip = None;
    }
    let publish = |summaries: &[NodeSummary]| -> Result<(), String> {
        let snapshot = {
            let _guard = store_lock()?;
            let mut latest = load()?;
            for summary in summaries {
                if let Some(current) = latest.nodes.iter_mut().find(|n| n.summary.id == summary.id)
                {
                    current.summary = summary.clone();
                }
            }
            save(&latest)?;
            NodeSnapshot {
                nodes: latest.nodes.into_iter().map(|n| n.summary).collect(),
                selected_id: latest.selected_id,
                runtime: ProxyRuntime {
                    running: Some(true),
                    version: Some(mihomo::VERSION.into()),
                },
            }
        };
        progress(snapshot);
        Ok(())
    };
    publish(
        &store
            .nodes
            .iter()
            .map(|n| n.summary.clone())
            .collect::<Vec<_>>(),
    )?;
    let next = std::sync::atomic::AtomicUsize::new(0);
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::scope(|scope| -> Result<(), String> {
        for _ in 0..8.min(store.nodes.len()) {
            let sender = sender.clone();
            let next = &next;
            let nodes = &store.nodes;
            let engine = &engine;
            scope.spawn(move || loop {
                let index = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let Some(item) = nodes.get(index) else {
                    break;
                };
                let mut summary = item.summary.clone();
                summary.status = "testing".into();
                if sender.send(summary.clone()).is_err() {
                    break;
                }
                // 即使延迟检测接口被阻止，也要继续检测出口地址。
                let delay = engine.node(index).and_then(|node| {
                    engine.delay(index, node["name"].as_str().ok_or("节点名称无效")?)
                });
                let result = test_proxy(&GeneralProxy {
                    protocol: "http".into(),
                    server: "127.0.0.1".into(),
                    port: engine.ports[index],
                    username: String::new(),
                    password: String::new(),
                });
                match result {
                    Ok((latency, ip, country)) => {
                        summary.latency = Some(delay.unwrap_or(latency));
                        summary.exit_ip = Some(ip);
                        summary.country_code = country.clone();
                        summary.region = country.map(|code| match code.as_str() {
                            "sg" => "新加坡".into(),
                            "hk" => "香港".into(),
                            "us" => "美国".into(),
                            "jp" => "日本".into(),
                            "tw" => "台湾".into(),
                            "de" => "德国".into(),
                            "gb" => "英国".into(),
                            _ => code.to_uppercase(),
                        });
                        summary.status = "connected".into();
                    }
                    Err(error) => {
                        summary.latency = delay.ok();
                        summary.status = if summary.latency.is_some() {
                            "connected"
                        } else {
                            "failed"
                        }
                        .into();
                        summary.error = Some(error);
                    }
                }
                if sender.send(summary).is_err() {
                    break;
                }
            });
        }
        drop(sender);
        for summary in receiver {
            publish(&[summary])?;
        }
        Ok(())
    })?;
    drop(engine);
    drop(session);
    progress(read()?);
    Ok(())
}
pub(crate) fn verify_runtime_exit(expected: &NodeSummary) -> Result<(), String> {
    let config = {
        let _guard = store_lock()?;
        let store = load()?;
        let record = store
            .nodes
            .iter()
            .find(|n| {
                Some(&n.summary.id) == store.selected_id.as_ref() && n.summary.id == expected.id
            })
            .ok_or("所选节点已变化")?;
        native_config(record)
    };
    let engine = mihomo::Engine::start(&[config])?;
    let (_, ip, country) = test_proxy(&GeneralProxy {
        protocol: "http".into(),
        server: "127.0.0.1".into(),
        port: engine.ports[0],
        username: String::new(),
        password: String::new(),
    })?;
    if Some(&ip) != expected.exit_ip.as_ref() || country != expected.country_code {
        return Err("实际出口与当前节点目标不一致，请返回节点页重新测速".into());
    }
    with_selected(expected, || Ok(()))
}

fn test_proxy(proxy: &GeneralProxy) -> Result<(u32, String, Option<String>), String> {
    validate_proxy(proxy)?;
    let protocol = if proxy.protocol == "socks5" {
        "socks5h"
    } else {
        &proxy.protocol
    };
    let host = if proxy.server.contains(':') && !proxy.server.starts_with('[') {
        format!("[{}]", proxy.server)
    } else {
        proxy.server.clone()
    };
    let mut url = url::Url::parse(&format!("{protocol}://{host}:{}", proxy.port))
        .map_err(|_| "代理地址无效")?;
    if !proxy.username.is_empty() {
        url.set_username(&proxy.username)
            .map_err(|_| "用户名无效")?;
        url.set_password(Some(&proxy.password))
            .map_err(|_| "密码无效")?;
    }
    let proxy = reqwest::Proxy::all(url.as_str()).map_err(|_| "代理地址无效")?;
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .proxy(proxy)
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(|_| "测试请求失败")?;
    detect_exit(
        &client,
        &[
            "https://www.cloudflare.com/cdn-cgi/trace",
            "https://speed.cloudflare.com/cdn-cgi/trace",
        ],
    )
}
fn detect_exit(
    client: &reqwest::blocking::Client,
    endpoints: &[&str],
) -> Result<(u32, String, Option<String>), String> {
    let mut error = "出口检测失败".to_owned();
    for endpoint in endpoints {
        let started = std::time::Instant::now();
        let result = (|| {
            let response = client
                .get(*endpoint)
                .send()
                .and_then(|r| r.error_for_status())
                .map_err(|e| {
                    if e.is_timeout() {
                        "出口检测超时，请检查节点连通性".to_owned()
                    } else if let Some(status) = e.status() {
                        format!("出口检测服务返回 HTTP {}", status.as_u16())
                    } else {
                        "出口连接失败，请检查节点服务器或 TLS 连接".to_owned()
                    }
                })?;
            let mut text = String::new();
            response
                .take(16384)
                .read_to_string(&mut text)
                .map_err(|_| "出口结果无法读取".to_owned())?;
            let ip = text
                .lines()
                .find_map(|line| line.strip_prefix("ip="))
                .filter(|ip| ip.parse::<std::net::IpAddr>().is_ok())
                .ok_or("未取得出口 IP")?;
            let country = text
                .lines()
                .find_map(|line| line.strip_prefix("loc="))
                .filter(|code| code.len() == 2 && code.bytes().all(|b| b.is_ascii_uppercase()))
                .map(str::to_lowercase);
            Ok((
                started.elapsed().as_millis().min(u32::MAX as u128) as u32,
                ip.into(),
                country,
            ))
        })();
        match result {
            Ok(exit) => return Ok(exit),
            Err(reason) => error = reason,
        }
    }
    Err(error)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires explicitly supplied node URI; does not modify installed nodes"]
    fn supplied_node_probe() {
        let uri = std::env::var("CODESEAM_PROBE_URI").expect("node URI required");
        let record = parse_link(&uri).unwrap();
        let engine = mihomo::Engine::start(&[native_config(&record)]).unwrap();
        let parsed = engine.node(0).unwrap();
        let node: serde_json::Value = serde_json::from_str(&identity(&record)).unwrap();
        println!(
            "parsed protocol={}, cipher={}, server={}, port={}",
            node["type"], node["cipher"], node["server"], node["port"]
        );
        let endpoint: std::net::SocketAddr = format!(
            "{}:{}",
            node["server"].as_str().unwrap(),
            node["port"].as_u64().unwrap()
        )
        .parse()
        .unwrap();
        let started = std::time::Instant::now();
        let tcp = std::net::TcpStream::connect_timeout(&endpoint, Duration::from_secs(5));
        println!(
            "TCP result={:?}, elapsed={}ms",
            tcp.as_ref().map(|_| ()).map_err(|e| e.kind()),
            started.elapsed().as_millis()
        );
        let delay = engine.delay(0, parsed["name"].as_str().unwrap());
        let exit = test_proxy(&GeneralProxy {
            protocol: "http".into(),
            server: "127.0.0.1".into(),
            port: engine.ports[0],
            username: String::new(),
            password: String::new(),
        });
        println!(
            "delay={delay:?}; exit={:?}",
            exit.map(|(ms, _, country)| (ms, country))
        );
    }
    #[test]
    #[ignore = "read-only probe of explicitly authorized installed nodes"]
    fn installed_nodes_probe() {
        let _lock = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
        let store = load().unwrap();
        let configs = store.nodes.iter().map(native_config).collect::<Vec<_>>();
        let engine = mihomo::Engine::start(&configs).unwrap();
        std::thread::scope(|scope| {
            for i in (0..store.nodes.len()).step_by(12) {
                let engine = &engine;
                scope.spawn(move || {
                    let node = engine.node(i).unwrap();
                    let delay = engine.delay(i, node["name"].as_str().unwrap());
                    let exit = test_proxy(&GeneralProxy {
                        protocol: "http".into(),
                        server: "127.0.0.1".into(),
                        port: engine.ports[i],
                        username: String::new(),
                        password: String::new(),
                    });
                    println!(
                        "node {i}: delay={delay:?}, exit={:?}",
                        exit.map(|(_, _, country)| country)
                    );
                });
            }
        });
    }
    #[test]
    fn exit_detection_falls_back_and_rejects_invalid_ip() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = std::thread::spawn(move || {
            for body in ["ip=not-an-ip\nloc=JP\n", "ip=203.0.113.7\nloc=JP\n"] {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0; 4096];
                stream.read(&mut request).unwrap();
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
                .unwrap();
            }
        });
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        let first = format!("http://{address}/first");
        let second = format!("http://{address}/second");
        let (_, ip, country) = detect_exit(&client, &[&first, &second]).unwrap();
        assert_eq!(ip, "203.0.113.7");
        assert_eq!(country.as_deref(), Some("jp"));
        worker.join().unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn encrypted_store_preserves_selection_and_never_returns_credentials() {
        let _lock = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
        let root = std::env::temp_dir().join(format!("codeseam-nodes-test-{}", std::process::id()));
        let prior = std::env::var_os("CODESEAM_TEST_DATA_DIR");
        std::env::set_var("CODESEAM_TEST_DATA_DIR", &root);
        let result = std::panic::catch_unwind(|| {
            import_proxy(GeneralProxy {
                protocol: "socks5".into(),
                server: "localhost".into(),
                port: 1080,
                username: "fixture-user".into(),
                password: "fixture-secret".into(),
            })
            .unwrap();
            assert!(has_nodes().unwrap());
            let snapshot = read().unwrap();
            assert!(snapshot.selected_id.is_none());
            let id = snapshot.nodes[0].id.clone();
            select(id.clone()).unwrap();
            assert_eq!(read().unwrap().selected_id, Some(id.clone()));
            let public = serde_json::to_string(&read().unwrap()).unwrap();
            assert!(!public.contains("fixture-user") && !public.contains("fixture-secret"));
            let encrypted =
                std::fs::read(vault::dir().unwrap().join("proxy-nodes-v1.dpapi")).unwrap();
            assert!(!encrypted.windows(14).any(|w| w == b"fixture-secret"));
            clear().unwrap();
            assert!(read().unwrap().nodes.is_empty());
            assert!(read().unwrap().selected_id.is_none());
            remove(id).unwrap();
            assert!(read().unwrap().selected_id.is_none());
            assert!(!has_nodes().unwrap());
        });
        match prior {
            Some(value) => std::env::set_var("CODESEAM_TEST_DATA_DIR", value),
            None => std::env::remove_var("CODESEAM_TEST_DATA_DIR"),
        };
        std::fs::remove_dir_all(root).unwrap();
        if let Err(error) = result {
            std::panic::resume_unwind(error);
        }
    }
    #[test]
    fn imports_are_atomic_and_do_not_invent_exit_facts() {
        let nodes =
            parse_content("vless://user@example.com:443#SG\n trojan://secret@example.org:443#HK")
                .unwrap();
        assert_eq!(nodes.len(), 2);
        assert!(nodes.iter().all(|n| n.summary.region.is_none()
            && n.summary.latency.is_none()
            && n.summary.status == "untested"));
        assert!(parse_content("vless://user@example.com:443#ok\ninvalid").is_err());
        assert!(parse_content("proxies:\n- name: broken\n  type: ss").is_err());
        assert!(parse_content("proxies: []").is_err());
    }
    #[test]
    #[ignore = "explicit live local proxy check"]
    fn live_proxy_exit_via_mihomo() {
        let proxy =
            serde_json::json!({"name":"live-local","type":"http","server":"127.0.0.1","port":4651});
        let engine = mihomo::Engine::start(&[proxy]).unwrap();
        let name = engine.node(0).unwrap()["name"].as_str().unwrap().to_owned();
        let delay = engine.delay(0, &name).unwrap();
        let (_, ip, country) = test_proxy(&GeneralProxy {
            protocol: "http".into(),
            server: "127.0.0.1".into(),
            port: engine.ports[0],
            username: String::new(),
            password: String::new(),
        })
        .unwrap();
        assert!(ip.parse::<std::net::IpAddr>().is_ok());
        assert!(country.is_some());
        println!("Live exit IP verified through Mihomo; country={country:?}; delay={delay}ms");
    }
    #[test]
    fn mihomo_parses_uri_and_yaml_via_provider_api() {
        let _lock = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
        let configs = vec![
            serde_json::json!({"uri":"trojan://fixture-password@127.0.0.1:9#fixture"}),
            serde_json::json!({"name":"香港 node + / #","type":"http","server":"127.0.0.1","port":9}),
        ];
        let engine = mihomo::Engine::start(&configs).unwrap();
        assert_eq!(engine.node(0).unwrap()["name"], "fixture");
        assert_eq!(engine.node(1).unwrap()["name"], "香港 node + / #");
        assert!(engine
            .delay(1, "香港 node + / #")
            .unwrap_err()
            .contains("503"));
        assert!(engine.delay(0, "fixture").is_err());
    }
    #[test]
    fn http_subscription_imports_all_nodes_and_deduplicates_retry() {
        use std::io::{Read, Write};
        let _lock = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
        let root = std::env::temp_dir().join(format!("codeseam-http-test-{}", std::process::id()));
        let prior = std::env::var_os("CODESEAM_TEST_DATA_DIR");
        std::env::set_var("CODESEAM_TEST_DATA_DIR", &root);
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = std::thread::spawn(move || {
            let body = STANDARD.encode(
                (0..10)
                    .map(|i| format!("trojan://fixture-{i}@127.0.0.1:9#node-{i}"))
                    .collect::<Vec<_>>()
                    .join("\n"),
            );
            for _ in 0..4 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0; 4096];
                let length = stream.read(&mut request).unwrap();
                if String::from_utf8_lossy(&request[..length]).contains("mihomo/1.19.34") {
                    write!(stream, "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
                    continue;
                }
                assert!(
                    String::from_utf8_lossy(&request[..length]).contains("ClashforWindows/0.20.39")
                );
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
                .unwrap();
            }
        });
        let result = std::panic::catch_unwind(|| {
            let first = import_links(format!("http://{address}/subscription")).unwrap();
            assert_eq!(first.added, 10);
            let retry = import_links(format!("http://{address}/subscription")).unwrap();
            assert_eq!((retry.added, retry.duplicates), (0, 10));
            assert_eq!(read().unwrap().nodes.len(), 10);
            let updates = std::cell::RefCell::new(Vec::new());
            test_with_progress(|snapshot| {
                if updates.borrow().is_empty() {
                    select(snapshot.nodes[1].id.clone()).unwrap();
                }
                updates.borrow_mut().push(snapshot);
            })
            .unwrap();
            let current = read().unwrap();
            assert_eq!(current.selected_id.as_ref(), Some(&current.nodes[1].id));
            let updates = updates.into_inner();
            assert_eq!(updates.len(), 22); // 包含排队、十次开始、十次结果和停止事件。
            assert!(updates.iter().all(|s| s
                .nodes
                .iter()
                .filter(|n| n.status == "testing")
                .count()
                <= 8));
            assert!(updates
                .iter()
                .any(|s| s.nodes.iter().any(|n| n.status == "queued")
                    && s.nodes.iter().any(|n| n.status == "testing")));
            assert!(updates
                .iter()
                .any(|s| s.nodes.iter().any(|n| n.status == "testing")));
            assert!(updates.iter().any(|s| s
                .nodes
                .iter()
                .filter(|n| n.status == "failed")
                .count()
                == 1));
            assert_eq!(updates.last().unwrap().runtime.running, Some(false));
            assert!(updates
                .first()
                .unwrap()
                .nodes
                .iter()
                .all(|n| n.status == "queued"));
            assert!(updates
                .last()
                .unwrap()
                .nodes
                .iter()
                .all(|n| n.status == "failed" && n.exit_ip.is_none()));
        });
        worker.join().unwrap();
        match prior {
            Some(value) => std::env::set_var("CODESEAM_TEST_DATA_DIR", value),
            None => std::env::remove_var("CODESEAM_TEST_DATA_DIR"),
        }
        std::fs::remove_dir_all(root).unwrap();
        result.unwrap();
    }
    #[test]
    fn identity_ignores_names_but_preserves_authentication() {
        let a = parse_link("trojan://secret@example.com:443#first").unwrap();
        let b = parse_link("trojan://secret@example.com:443#renamed").unwrap();
        let c = parse_link("trojan://different@example.com:443#first").unwrap();
        assert_eq!(identity(&a), identity(&b));
        assert_ne!(identity(&a), identity(&c));
        let plain = parse_link("ss://aes-128-gcm:secret@example.com:1234#one").unwrap();
        let encoded = parse_link(&format!(
            "ss://{}@example.com:1234#two",
            STANDARD_NO_PAD.encode("aes-128-gcm:secret")
        ))
        .unwrap();
        assert_eq!(identity(&plain), identity(&encoded));
        assert_eq!(
            parse_content(
                &STANDARD.encode("vless://user@example.com:443#a\nvless://other@example.com:443#b")
            )
            .unwrap()
            .len(),
            2
        );
        assert!(parse_content("YQ==").is_err());
    }
    #[test]
    #[ignore = "requires local Mihomo and an explicitly supplied subscription"]
    fn real_subscription_roundtrip() {
        let _lock = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
        let root = std::env::temp_dir().join(format!("codeseam-live-{}", std::process::id()));
        std::env::set_var("CODESEAM_TEST_DATA_DIR", &root);
        let url = std::env::var("CODESEAM_SUBSCRIPTION_URL").expect("subscription required");
        let first = import_links(url.clone()).unwrap();
        assert!(first.added > 1);
        let second = import_links(url).unwrap();
        assert_eq!(second.added, 0);
        assert_eq!(second.duplicates, first.added + first.duplicates);
        test().unwrap();
        let snapshot = read().unwrap();
        let connected = snapshot
            .nodes
            .iter()
            .filter(|n| n.status == "connected")
            .count();
        println!(
            "Imported {}, duplicate retry skipped {}, real exits detected {}",
            first.added, second.duplicates, connected
        );
        assert!(connected > 0);
        std::env::remove_var("CODESEAM_TEST_DATA_DIR");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn validates_ports_hosts_and_protocols() {
        let mut proxy = GeneralProxy {
            protocol: "socks5".into(),
            server: "localhost".into(),
            port: 1080,
            username: "".into(),
            password: "".into(),
        };
        assert!(validate_proxy(&proxy).is_ok());
        proxy.port = 0;
        assert!(validate_proxy(&proxy).is_err());
        proxy.port = 1080;
        proxy.server = "host/path".into();
        assert!(validate_proxy(&proxy).is_err());
        proxy.server = "localhost".into();
        proxy.protocol = "ftp".into();
        assert!(validate_proxy(&proxy).is_err());
    }
}

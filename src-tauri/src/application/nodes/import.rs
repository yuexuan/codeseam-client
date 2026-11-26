use super::store::{load, save, store_lock, Record, Store};
use crate::{domain::nodes::*, infrastructure::mihomo};
use base64::{
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE_NO_PAD},
    Engine,
};
use std::{
    io::Read,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

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
pub(super) fn parse_link(link: &str) -> Result<Record, String> {
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
pub(super) fn parse_content(content: &str) -> Result<Vec<Record>, String> {
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
pub(super) fn native_config(item: &Record) -> serde_json::Value {
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
pub(super) fn identity(item: &Record) -> String {
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

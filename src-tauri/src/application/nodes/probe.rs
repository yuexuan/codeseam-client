use super::{
    import::{native_config, validate_proxy},
    read,
    store::{load, save, store_lock},
    with_selected,
};
use crate::{domain::nodes::*, infrastructure::mihomo};
use std::{io::Read, time::Duration};

pub(super) static TEST_RUNNING: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
struct TestSession;
impl Drop for TestSession {
    fn drop(&mut self) {
        TEST_RUNNING.store(false, std::sync::atomic::Ordering::Release);
    }
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
    test_nodes(ids, true, progress)
}

pub(crate) fn test_all_in_background() -> Result<(), String> {
    test_nodes(Vec::new(), false, |_| {})
}

fn test_nodes(
    ids: Vec<String>,
    publish_pending: bool,
    progress: impl Fn(NodeSnapshot),
) -> Result<(), String> {
    let mut store = {
        let _guard = store_lock()?;
        load()?
    };
    let ranks: std::collections::HashMap<_, _> =
        ids.iter().enumerate().map(|(i, id)| (id, i)).collect();
    if !ids.is_empty() {
        store
            .nodes
            .retain(|node| ranks.contains_key(&node.summary.id));
    }
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
    if publish_pending {
        publish(
            &store
                .nodes
                .iter()
                .map(|n| n.summary.clone())
                .collect::<Vec<_>>(),
        )?;
    }
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
            if publish_pending || summary.status != "testing" {
                publish(&[summary])?;
            }
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

pub(super) fn test_proxy(proxy: &GeneralProxy) -> Result<(u32, String, Option<String>), String> {
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
pub(super) fn detect_exit(
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

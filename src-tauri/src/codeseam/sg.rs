//! 本地 SS 配置档；凭据只通过当前用户的 DPAPI 持久化。
use super::{network::Check, vault};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use shadowsocks_service::{
    config::{Config, ConfigType},
    local::Server,
};
use std::{net::IpAddr, time::Duration};

const FILE: &str = "sg-node.dpapi";
#[derive(Serialize, Deserialize)]
struct Node {
    host: String,
    port: u16,
    method: String,
    password: String,
    expected: Option<String>,
}

fn parse(uri: &str, expected: Option<String>) -> Result<Node, String> {
    let raw = uri
        .trim()
        .strip_prefix("ss://")
        .ok_or("请输入 ss:// 节点链接")?;
    let authority = raw.split('#').next().unwrap_or("");
    if authority.contains('?') {
        return Err("暂不支持带插件的 SS 节点".into());
    }
    let (auth, address) = authority.rsplit_once('@').ok_or("节点链接缺少地址")?;
    let decoded = URL_SAFE_NO_PAD
        .decode(auth.trim_end_matches('='))
        .map_err(|_| "节点认证编码无效")?;
    let auth = String::from_utf8(decoded).map_err(|_| "节点认证格式无效")?;
    let (method, password) = auth.split_once(':').ok_or("节点缺少加密方法或密码")?;
    if !["aes-128-gcm", "aes-256-gcm", "chacha20-ietf-poly1305"].contains(&method)
        || password.is_empty()
    {
        return Err("支持 AES-128/256-GCM 或 ChaCha20-IETF-Poly1305，密码不可为空".into());
    }
    let url = reqwest::Url::parse(&format!("http://{}", address.trim_end_matches('/')))
        .map_err(|_| "节点地址无效")?;
    if !url.username().is_empty() || url.password().is_some() || url.path() != "/" {
        return Err("节点地址格式无效".into());
    }
    let host = url.host_str().ok_or("节点缺少主机")?.to_string();
    let port = url.port().ok_or("节点缺少端口")?;
    if port == 0 {
        return Err("端口不可为零".into());
    }
    let expected = expected
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string());
    if expected
        .as_ref()
        .is_some_and(|s| s.parse::<std::net::Ipv4Addr>().is_err())
    {
        return Err("预期出口必须是 IPv4 地址".into());
    }
    Ok(Node {
        host,
        port,
        method: method.into(),
        password: password.into(),
        expected,
    })
}
fn load() -> Result<Option<Node>, String> {
    vault::read(FILE)?
        .map(|b| serde_json::from_slice(&b).map_err(|_| "本地节点配置损坏，请重新导入".into()))
        .transpose()
}
pub fn summary() -> Result<Value, String> {
    Ok(match load()? {
        Some(n) => json!({"configured":true,"method":n.method,"expected":n.expected}),
        None => json!({"configured":false}),
    })
}
#[tauri::command]
pub fn cs_sg_import(uri: String, expected: Option<String>) -> Result<Value, String> {
    let n = parse(&uri, expected)?;
    vault::save(FILE, &serde_json::to_vec(&n).map_err(|_| "节点编码失败")?)?;
    summary()
}
#[tauri::command]
pub fn cs_sg_status() -> Result<Value, String> {
    summary()
}
#[tauri::command]
pub fn cs_sg_remove() -> Result<(), String> {
    vault::remove(FILE)
}

pub struct LocalProxy {
    pub address: String,
    pub expected: String,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for LocalProxy {
    fn drop(&mut self) {
        self.task.abort();
    }
}
pub async fn browser_proxy() -> Result<Option<LocalProxy>, String> {
    let Some(n) = load()? else { return Ok(None) };
    let text=json!({"server":n.host,"server_port":n.port,"password":n.password,"method":n.method,"local_address":"127.0.0.1","local_port":1080,"protocol":"http","mode":"tcp_only","timeout":10}).to_string();
    let mut config =
        Config::load_from_str(&text, ConfigType::Local).map_err(|_| "无法启动已配置的代理节点")?;
    config.local[0].config.addr = Some(
        shadowsocks_service::shadowsocks::config::ServerAddr::SocketAddr(
            "127.0.0.1:0".parse().unwrap(),
        ),
    );
    let server = Server::new(config)
        .await
        .map_err(|_| "无法创建浏览器代理")?;
    let addr = server
        .http_servers()
        .first()
        .ok_or("HTTP 代理未启动")?
        .local_addr()
        .map_err(|_| "无法读取代理端口")?;
    Ok(Some(LocalProxy {
        address: format!("http://{addr}"),
        expected: n.expected.unwrap_or_default(),
        task: tokio::spawn(async move {
            let _ = server.run().await;
        }),
    }))
}

struct Abort(tokio::task::JoinHandle<()>);
impl Drop for Abort {
    fn drop(&mut self) {
        self.0.abort();
    }
}

#[tauri::command]
pub async fn cs_sg_probe() -> Result<Value, String> {
    let n = load()?.ok_or("请先导入 SS 节点")?;
    // 先绑定临时监听端口再启动服务，避免端口竞争。
    let text = json!({"server":n.host,"server_port":n.port,"password":n.password,
        "method":n.method,"local_address":"127.0.0.1","local_port":1080,
        "protocol":"http","mode":"tcp_only","timeout":10})
    .to_string();
    let mut config =
        Config::load_from_str(&text, ConfigType::Local).map_err(|_| "无法创建节点配置")?;
    config.local[0].config.addr = Some(
        shadowsocks_service::shadowsocks::config::ServerAddr::SocketAddr(
            "127.0.0.1:0".parse().unwrap(),
        ),
    );
    let server = Server::new(config)
        .await
        .map_err(|_| "无法绑定本地测试代理")?;
    let addr = server
        .http_servers()
        .first()
        .ok_or("测试代理未启动")?
        .local_addr()
        .map_err(|_| "无法获取测试端口")?;
    let _guard = Abort(tokio::spawn(async move {
        let _ = server.run().await;
    }));
    let client = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(format!("http://{addr}")).map_err(|_| "测试代理地址无效")?)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "测试客户端创建失败")?;
    let mut response = None;
    let mut failures = Vec::new();
    // 两次探测都使用显式指定的 SS 代理，绝不回退为直连。
    for endpoint in ["https://api4.ipify.org", "https://ipv4.icanhazip.com"] {
        match client.get(endpoint).send().await {
            Ok(r) if r.status().is_success() => {
                response = Some(r);
                break;
            }
            Ok(r) => failures.push(format!("{endpoint}: HTTP {}", r.status())),
            Err(e) => {
                let reason = if e.is_timeout() {
                    "请求超时"
                } else if e.is_connect() {
                    "代理隧道或 TLS 连接失败"
                } else {
                    "HTTPS 请求失败"
                };
                failures.push(format!("{endpoint}: {reason}"));
            }
        }
    }
    let response = response.ok_or_else(|| {
        format!(
            "内置 SS 出口测试未完成（{}）；未验证出口，不能据此判定 Clash 节点失效；未回退直连",
            failures.join("；")
        )
    })?;
    if !response.status().is_success() {
        return Err("出口服务返回错误，未完成验证".into());
    }
    let text = response.text().await.map_err(|_| "出口响应读取失败")?;
    let ip: IpAddr = text.trim().parse().map_err(|_| "出口响应不是有效 IP")?;
    if !ip.is_ipv4() {
        return Err("未获得 IPv4 出口".into());
    }
    let matched = n.expected.as_ref().map(|e| e == &ip.to_string());
    Ok(
        json!({"ip":ip.to_string(),"expectedMatch":matched,"scope":"本次 HTTPS 测试请求","regionVerified":false}),
    )
}
pub async fn diagnose() -> Check {
    let mut result = check();
    if summary().ok().is_none_or(|v| v["configured"] != true) {
        return result;
    }
    match cs_sg_probe().await {
        Ok(v) => {
            result.status = if v["expectedMatch"] == false {
                "fail"
            } else {
                "pass"
            }
            .into();
            result.detail = format!(
                "{} · {}",
                v["ip"].as_str().unwrap_or("未取得出口"),
                if v["expectedMatch"] == false {
                    "与预期不一致"
                } else {
                    "连接正常"
                }
            );
            result.evidence = Some(v.to_string());
            result.remediation = if result.status == "pass" {
                None
            } else {
                Some("核对下方节点与预期出口后重新检测".into())
            };
        }
        Err(e) => {
            result.status = "fail".into();
            result.detail = e;
        }
    }
    result
}

pub fn check() -> Check {
    let configured = load().ok().flatten().is_some();
    Check {
        id: "local_sg_node".into(),
        label: "本地 SS 节点".into(),
        status: if configured { "unknown" } else { "warning" }.into(),
        detail: if configured {
            "节点已加密保存，可测试实际出口；未接管 Clash 或启用全局守护"
        } else {
            "尚未导入本地 SS 节点"
        }
        .into(),
        protected: false,
        evidence: None,
        remediation: Some("在下方节点入口导入并测试出口".into()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_bad_inputs() {
        for u in [
            "http://x",
            "ss://invalid@x:80",
            "ss://YWVzLTEyOC1nY206cA@x:0",
            "ss://YWVzLTEyOC1nY206cA@x:80?plugin=x",
        ] {
            assert!(parse(u, None).is_err());
        }
        let n = parse("ss://YWVzLTEyOC1nY206cA@127.0.0.1:1443#test", None).unwrap();
        assert_eq!(n.method, "aes-128-gcm");
        assert!(parse("ss://YWVzLTEyOC1nY206cA@x:1443", Some("bad".into())).is_err());
    }
    #[tokio::test]
    #[ignore = "read-only probe of the current user's saved node; requires network"]
    async fn probe_saved_node() {
        match cs_sg_probe().await {
            Ok(v) => println!("SS probe result: {v}"),
            Err(e) => panic!("{e}"),
        }
    }
    #[tokio::test]
    #[ignore = "explicit local real-node import and probe"]
    async fn import_real_node() {
        let uri = std::env::var("CODESEAM_SG_URI").expect("node supplied through environment");
        cs_sg_import(uri, None).unwrap();
        assert!(!summary().unwrap().to_string().contains("password"));
        match cs_sg_probe().await {
            Ok(v) => println!("SS probe result: {v}"),
            Err(e) => panic!("{e}"),
        }
    }
}

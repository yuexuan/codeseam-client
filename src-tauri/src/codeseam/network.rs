//! Windows-first network evidence for the CodeSeam managed Claude path.
//!
//! This module deliberately reports uncertainty instead of upgrading a heuristic to
//! PASS.  The HTTP egress probes use the assigned proxy when one is available.  A
//! public egress address is evidence for that request only; it is not a claim that
//! every process on the machine uses the same route.

use reqwest::{Client, Proxy, Url};
use serde::Serialize;
use serde_json::Value;
use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::net::{TcpStream, UdpSocket};

pub const STATUS_PASS: &str = "pass";
pub const STATUS_WARNING: &str = "warning";
pub const STATUS_FAIL: &str = "fail";
pub const STATUS_UNKNOWN: &str = "unknown";
pub const STATUS_NOT_APPLICABLE: &str = "not_applicable";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub id: String,
    pub label: String,
    pub status: String,
    pub detail: String,
    pub evidence: Option<String>,
    pub protected: bool,
    pub remediation: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub generated_at: u64,
    pub checks: Vec<Check>,
    pub can_start: bool,
    pub api_protection: String,
    pub non_api_coverage: String,
}

#[derive(Clone, Debug)]
pub struct Context {
    pub local_port: u16,
    pub server_url: String,
    pub expected_egress: Option<String>,
    /// Private URL assembled from the server-owned network configuration. It is
    /// never returned to React or included in diagnostics evidence.
    pub assigned_proxy: Option<String>,
    pub proxy_running: bool,
    pub cli_configured: bool,
}

fn check(id: &str, label: &str, status: &str, detail: impl Into<String>, protected: bool) -> Check {
    Check {
        id: id.into(),
        label: label.into(),
        status: status.into(),
        detail: detail.into(),
        evidence: None,
        protected,
        remediation: None,
    }
}

fn with_evidence(mut c: Check, evidence: impl Into<String>) -> Check {
    c.evidence = Some(evidence.into());
    c
}

fn remediation(mut c: Check, text: impl Into<String>) -> Check {
    c.remediation = Some(text.into());
    c
}

fn client(proxy_url: Option<&str>) -> Result<Client, String> {
    let mut builder = Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(6))
        .user_agent("CodeSeam-Network-Diagnostic/1");
    if let Some(raw) = proxy_url {
        let proxy = Proxy::all(raw).map_err(|e| format!("受管代理地址无效：{e}"))?;
        builder = builder.proxy(proxy);
    }
    builder
        .build()
        .map_err(|e| format!("创建诊断客户端失败：{e}"))
}

async fn text_probe(client: &Client, endpoint: &str) -> Result<String, String> {
    let response = client
        .get(endpoint)
        .send()
        .await
        .map_err(|e| format!("请求失败：{e}"))?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status().as_u16()));
    }
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败：{e}"))?;
    let value = body.trim();
    value
        .parse::<IpAddr>()
        .map_err(|_| "响应不是 IP 地址（未把它当作出口证据）".to_string())?;
    Ok(value.to_string())
}

fn expected_matches(expected: Option<&str>, observed: &str) -> Option<bool> {
    let expected = expected?.trim().parse::<IpAddr>().ok()?;
    let observed = observed.parse::<IpAddr>().ok()?;
    Some(expected == observed)
}

async fn egress_check(ctx: &Context) -> (Check, Check) {
    let Some(proxy) = ctx.assigned_proxy.as_deref() else {
        let v4 = remediation(
            check(
                "egress_ipv4",
                "IPv4 出口",
                STATUS_FAIL,
                "服务未下发可用的专属代理，受保护请求没有可验证的指定出口",
                true,
            ),
            "重新激活服务并重新获取网络配置",
        );
        let v6 = remediation(
            check(
                "egress_ipv6",
                "IPv6 出口",
                STATUS_FAIL,
                "服务未下发可用的专属代理，无法验证 IPv6 是否旁路",
                true,
            ),
            "重新激活服务并重新获取网络配置",
        );
        return (v4, v6);
    };
    let Ok(proxy_client) = client(Some(proxy)) else {
        let v4 = check(
            "egress_ipv4",
            "IPv4 出口",
            STATUS_FAIL,
            "无法创建受管代理诊断客户端",
            true,
        );
        let v6 = check(
            "egress_ipv6",
            "IPv6 出口",
            STATUS_FAIL,
            "无法创建受管代理诊断客户端",
            true,
        );
        return (v4, v6);
    };
    let v4 = text_probe(&proxy_client, "https://api.ipify.org").await;
    let v4_check = match v4 {
        Ok(ip) => {
            let status = match expected_matches(ctx.expected_egress.as_deref(), &ip) {
                Some(true) => STATUS_PASS,
                Some(false) => STATUS_FAIL,
                None => STATUS_UNKNOWN,
            };
            let detail = if status == STATUS_PASS {
                format!("经受管代理观察到出口 {ip}，与服务端预期一致")
            } else {
                format!("经受管代理观察到出口 {ip}，未能与预期出口完成匹配")
            };
            with_evidence(check("egress_ipv4", "IPv4 出口", status, detail, true), ip)
        }
        Err(error) => check("egress_ipv4", "IPv4 出口", STATUS_FAIL, error, true),
    };
    let v6_check = match text_probe(&proxy_client, "https://api6.ipify.org").await {
        Ok(ip) => with_evidence(
            check(
                "egress_ipv6",
                "IPv6 出口",
                STATUS_WARNING,
                "观察到 IPv6 出口，但 HTTP 代理未证明 IPv6 旁路已被网络层阻断",
                true,
            ),
            ip,
        ),
        Err(error) => check(
            "egress_ipv6",
            "IPv6 出口",
            STATUS_UNKNOWN,
            format!("IPv6 出口探针未完成：{error}；未据此宣称安全"),
            true,
        ),
    };
    (v4_check, v6_check)
}

async fn dns_check(ctx: &Context) -> Check {
    let host = match Url::parse(&ctx.server_url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
    {
        Some(host) => host,
        None => {
            return check(
                "dns",
                "DNS 路径",
                STATUS_UNKNOWN,
                "服务地址无法解析主机名",
                true,
            )
        }
    };
    let resolved = tokio::time::timeout(
        Duration::from_secs(3),
        tokio::net::lookup_host((host.as_str(), 443)),
    )
    .await;
    let addresses: Vec<SocketAddr> = match resolved {
        Ok(Ok(iter)) => iter.collect(),
        Ok(Err(error)) => {
            return check(
                "dns",
                "DNS 路径",
                STATUS_FAIL,
                format!("系统解析失败：{error}"),
                true,
            )
        }
        Err(_) => return check("dns", "DNS 路径", STATUS_FAIL, "DNS 解析超时", true),
    };
    if ctx.assigned_proxy.is_some() {
        with_evidence(
            check(
                "dns",
                "DNS 路径",
                STATUS_UNKNOWN,
                "本机解析到服务地址，但 HTTP 代理的远端解析不可观测；不能把本机结果当作无泄漏证明",
                true,
            ),
            format!(
                "本机观察到 {}",
                addresses
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        )
    } else {
        remediation(
            with_evidence(
                check(
                    "dns",
                    "DNS 路径",
                    STATUS_FAIL,
                    "服务请求没有受管代理，系统 DNS/直连路径可被旁路",
                    true,
                ),
                addresses
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join(", "),
            ),
            "重新激活服务并确认代理配置未漂移",
        )
    }
}

async fn udp_check(ctx: &Context) -> Check {
    let socket = match UdpSocket::bind("0.0.0.0:0").await {
        Ok(socket) => socket,
        Err(error) => {
            return check(
                "udp",
                "UDP 路由",
                STATUS_UNKNOWN,
                format!("无法创建 UDP socket：{error}"),
                false,
            )
        }
    };
    let payload = [
        0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07, b'e', b'x',
        b'a', b'm', b'p', b'l', b'e', 0x03, b'c', b'o', b'm', 0x00, 0x00, 0x01, 0x00, 0x01,
    ];
    let _ = socket.send_to(&payload, "1.1.1.1:53").await;
    let mut response = [0u8; 512];
    match tokio::time::timeout(Duration::from_secs(3), socket.recv_from(&mut response)).await {
        Ok(Ok((size, peer))) => {
            let detail = if ctx.assigned_proxy.is_some() {
                "UDP 可达，但现有 HTTP 代理不会自动约束 UDP；保护范围未覆盖"
            } else {
                "UDP 可达，当前没有受管代理路径"
            };
            remediation(
                with_evidence(
                    check("udp", "UDP 路由", STATUS_WARNING, detail, false),
                    format!("收到 {size} 字节，来自 {peer}"),
                ),
                "需要 UDP/WebRTC 保护时配置受控隧道或 Windows 网络规则；当前不宣称已保护",
            )
        }
        Ok(Err(error)) => check(
            "udp",
            "UDP 路由",
            STATUS_UNKNOWN,
            format!("UDP 响应失败：{error}"),
            false,
        ),
        Err(_) => check(
            "udp",
            "UDP 路由",
            STATUS_UNKNOWN,
            "UDP 探针超时；未把超时当作安全证明",
            false,
        ),
    }
}

async fn local_route_check(ctx: &Context) -> Check {
    if !ctx.proxy_running {
        return remediation(
            check(
                "kill_switch",
                "Kill-Switch",
                STATUS_FAIL,
                "本地受管代理未运行；受保护请求应被拒绝",
                true,
            ),
            "重新激活服务；不要把 CLI 地址改回真实上游",
        );
    }
    let address = format!("127.0.0.1:{}", ctx.local_port);
    match tokio::time::timeout(Duration::from_secs(2), TcpStream::connect(&address)).await {
        Ok(Ok(_)) => with_evidence(
            check(
                "kill_switch",
                "Kill-Switch",
                STATUS_PASS,
                "本地代理端口可连接；停止它后 localhost 请求将失败，不存在直连回退",
                true,
            ),
            address,
        ),
        Ok(Err(error)) => remediation(
            check(
                "kill_switch",
                "Kill-Switch",
                STATUS_FAIL,
                format!("本地代理端口不可连接：{error}"),
                true,
            ),
            "重新激活服务并复测",
        ),
        Err(_) => remediation(
            check(
                "kill_switch",
                "Kill-Switch",
                STATUS_FAIL,
                "连接本地代理超时",
                true,
            ),
            "重新激活服务并复测",
        ),
    }
}

pub async fn diagnose(ctx: Context) -> Report {
    let mut checks = Vec::new();
    let proxy = if ctx.assigned_proxy.is_some() {
        match client(ctx.assigned_proxy.as_deref()) {
            Ok(_) => check(
                "proxy",
                "受管代理",
                STATUS_PASS,
                "已创建不使用环境代理的受管 HTTP 客户端",
                true,
            ),
            Err(error) => check("proxy", "受管代理", STATUS_FAIL, error, true),
        }
    } else {
        remediation(
            check(
                "proxy",
                "受管代理",
                STATUS_FAIL,
                "未收到服务端代理配置",
                true,
            ),
            "重新激活服务",
        )
    };
    checks.push(proxy);
    let (v4, v6) = egress_check(&ctx).await;
    checks.push(v4);
    checks.push(v6);
    checks.push(dns_check(&ctx).await);
    checks.push(udp_check(&ctx).await);
    checks.push(local_route_check(&ctx).await);
    checks.push(if ctx.cli_configured {
        check(
            "config",
            "受管配置",
            STATUS_PASS,
            "Claude Code 的 localhost 地址和占位授权与当前端口一致",
            true,
        )
    } else {
        remediation(
            check(
                "config",
                "受管配置",
                STATUS_FAIL,
                "Claude Code 配置缺失或发生漂移，未允许启动",
                true,
            ),
            "确认后执行备份并配置",
        )
    });
    checks.push(Check {
        id: "webrtc".into(),
        label: "WebRTC / STUN".into(),
        status: STATUS_NOT_APPLICABLE.into(),
        detail: "当前受管表面是 Claude Code CLI，没有浏览器 WebRTC API；未伪造 STUN 结果".into(),
        evidence: None,
        protected: false,
        remediation: Some("浏览器/Electron 场景接入后再做 STUN 候选验证".into()),
    });
    checks.push(Check {
        id: "non_api".into(),
        label: "Claude Code 非 API 流量".into(),
        status: STATUS_WARNING.into(),
        detail: "当前只把 API 请求锁定到 localhost；Claude Code 其他联网进程路径没有 Windows WFP/TUN 证据，按未覆盖处理".into(),
        evidence: Some("受管启动会注入 HTTP(S)_PROXY/ALL_PROXY；尚无 Windows WFP/TUN 规则证明进程所有连接 fail-closed".into()),
        protected: false,
        remediation: Some("需要覆盖非 API 流量时，接入经实测的 Windows 网络规则/受控隧道后再升级状态".into()),
    });
    let blocking = checks
        .iter()
        .any(|c| c.protected && c.status == STATUS_FAIL);
    let api_status = if blocking {
        STATUS_FAIL
    } else if checks
        .iter()
        .any(|c| c.protected && c.status == STATUS_UNKNOWN)
    {
        STATUS_UNKNOWN
    } else {
        STATUS_PASS
    };
    Report {
        generated_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        checks,
        can_start: !blocking,
        api_protection: api_status.into(),
        non_api_coverage: "not_covered".into(),
    }
}

/// Build the private proxy URL returned by the service. It is kept in Rust only.
pub fn assigned_proxy_url(network: &Value) -> Option<String> {
    let p = network.get("proxy")?;
    let protocol = p.get("protocol")?.as_str()?.trim().to_ascii_lowercase();
    if protocol != "http" && protocol != "https" {
        return None;
    }
    let host = p.get("host")?.as_str()?.trim();
    let port: u16 = p.get("port")?.as_u64()?.try_into().ok()?;
    let host = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    let mut url = Url::parse(&format!("{protocol}://{host}:{port}")).ok()?;
    if let Some(user) = p
        .get("username")
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
    {
        url.set_username(user).ok()?;
    }
    if let Some(password) = p
        .get("password")
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
    {
        url.set_password(Some(password)).ok()?;
    }
    Some(url.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn proxy_url_is_private_and_supports_ipv6_hosts() {
        let v = json!({"proxy":{"protocol":"http","host":"2001:db8::1","port":8080,"username":"u","password":"p"}});
        let url = assigned_proxy_url(&v).unwrap();
        assert!(url.starts_with("http://u:p@[2001:db8::1]:8080"));
    }

    #[test]
    fn unsupported_proxy_protocol_is_not_used() {
        let v = json!({"proxy":{"protocol":"socks5","host":"127.0.0.1","port":1080}});
        assert!(assigned_proxy_url(&v).is_none());
    }

    #[test]
    fn expected_ip_match_is_strict() {
        assert_eq!(expected_matches(Some("192.0.2.1"), "192.0.2.1"), Some(true));
        assert_eq!(
            expected_matches(Some("192.0.2.1"), "192.0.2.2"),
            Some(false)
        );
    }
}

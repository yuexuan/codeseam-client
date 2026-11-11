//! 只读取 Windows/CFW 环境信息，不修改控制器配置或订阅内容。
use super::network::Check;
use serde_json::Value;
use std::time::Duration;
fn item(id: &str, label: &str, status: &str, detail: impl Into<String>) -> Check {
    Check {
        id: id.into(),
        label: label.into(),
        status: status.into(),
        detail: detail.into(),
        evidence: None,
        protected: false,
        remediation: None,
    }
}
// 只读取根对象中的标量值；拒绝信息不明确或位于远程的控制器。
fn scalar(text: &str, key: &str) -> Option<String> {
    let prefix = format!("{key}:");
    let mut values = text.lines().filter_map(|line| line.strip_prefix(&prefix));
    let value = values.next()?.trim().trim_matches(['\'', '"']).to_string();
    if values.next().is_some() {
        return None;
    }
    Some(value)
}
async fn clash(profile: Option<&Value>) -> Vec<Check> {
    let mut out = vec![];
    let config = dirs::home_dir().map(|p| p.join(".config/clash/config.yaml"));
    let Some(text) = config.and_then(|p| std::fs::read_to_string(p).ok()) else {
        return vec![item(
            "clash",
            "Clash 控制接口",
            "unknown",
            "未找到当前用户 CFW 配置；未扫描或修改其他用户配置",
        )];
    };
    let Some(address) = scalar(&text, "external-controller")
        .and_then(|v| v.parse::<std::net::SocketAddr>().ok())
        .filter(|a| a.ip().is_loopback())
    else {
        return vec![item(
            "clash",
            "Clash 控制接口",
            "unknown",
            "控制接口不是可确认的本机地址，拒绝发送控制凭据",
        )];
    };
    let Ok(client) = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(3))
        .build()
    else {
        return out;
    };
    let secret = scalar(&text, "secret").unwrap_or_default();
    let base = format!("http://{address}");
    let get = |path: &str| client.get(format!("{base}{path}")).bearer_auth(&secret);
    let version = match get("/version").send().await {
        Ok(r) if r.status().is_success() => r.json::<Value>().await.ok(),
        _ => None,
    };
    let Some(version) = version else {
        return vec![item(
            "clash",
            "Clash 控制接口",
            "fail",
            "CFW 控制接口不可达或认证失败；未输出凭据",
        )];
    };
    out.push(item(
        "clash",
        "Clash 控制接口",
        "pass",
        format!(
            "内核 {}；只读连接成功",
            version["version"].as_str().unwrap_or("unknown")
        ),
    ));
    let tun = match get("/configs").send().await {
        Ok(r) if r.status().is_success() => r.json::<Value>().await.ok(),
        _ => None,
    };
    let adapters = tokio::task::spawn_blocking(|| {
        super::cli::hidden("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command",
            "Get-NetAdapter -IncludeHidden -ErrorAction Stop | Select-Object Name,InterfaceDescription,Status | ConvertTo-Json -Compress"])
            .output().ok().filter(|o| o.status.success())
            .and_then(|o| serde_json::from_slice::<Value>(&o.stdout).ok())
    }).await.ok().flatten();
    out.push(tun_check(tun.as_ref(), adapters.as_ref()));
    let proxies = match get("/proxies").send().await {
        Ok(r) if r.status().is_success() => r.json::<Value>().await.ok(),
        _ => None,
    };
    if let Some(proxies) = proxies {
        let names: Vec<_> = proxies["proxies"]
            .as_object()
            .map(|p| p.keys().cloned().collect())
            .unwrap_or_default();
        out.push(item(
            "clash_nodes",
            "本机真实节点与策略",
            "pass",
            names.join("、"),
        ));
        let group = &proxies["proxies"]["Claude-SG"];
        out.push(item(
            "clash_policy",
            "Claude-SG 实际路由",
            "unknown",
            if group.is_null() {
                "策略不存在，尚未初始化；未修改用户订阅"
            } else {
                "策略存在，但策略存在不证明 Axum 请求命中，仍需独立路由和出口验证"
            },
        ));
        if let Some(p) = profile.filter(|p| p.is_object()) {
            let node = p["clash_node"].as_str().unwrap_or("");
            let exists = names.iter().any(|n| n == node)
                && !matches!(
                    proxies["proxies"][node]["type"].as_str(),
                    Some("Direct" | "Reject" | "Selector" | "Fallback" | "URLTest" | "LoadBalance")
                        | None
                );
            out.push(item(
                "sg_node",
                "指定 SG 固定节点",
                if exists { "unknown" } else { "fail" },
                if exists {
                    format!("节点 {node} 存在；名称不证明地区或固定出口，尚待实测")
                } else {
                    "Profile 指定节点缺失或不是固定节点，拒绝其他节点回退".into()
                },
            ));
        }
    }
    out
}

// 仅凭控制器开关状态，无法证明 Windows 已创建对应的网络接口。
fn tun_check(config: Option<&Value>, adapters: Option<&Value>) -> Check {
    let enabled = config.and_then(|v| v["tun"]["enable"].as_bool());
    let device = config
        .and_then(|v| v["tun"]["device"].as_str())
        .unwrap_or("");
    let rows: Vec<&Value> = match adapters {
        Some(Value::Array(rows)) => rows.iter().collect(),
        Some(row) if row.is_object() => vec![row],
        _ => vec![],
    };
    let active = rows.iter().any(|a| {
        let name = a["Name"].as_str().unwrap_or("");
        let description = a["InterfaceDescription"]
            .as_str()
            .unwrap_or("")
            .to_lowercase();
        a["Status"] == "Up"
            && ((!device.is_empty() && name.eq_ignore_ascii_case(device))
                || description.contains("clash tunnel")
                || description.contains("mihomo")
                || description.contains("wintun")
                || description.contains("meta tunnel"))
    });
    let (status, detail) = match enabled {
        Some(false) => (
            "warning",
            "运行中内核 tun.enable=false；界面开关可能未应用，请检查代理软件运行配置",
        ),
        Some(true) if active => (
            "pass",
            "运行中内核已启用 TUN，且匹配的 Windows 网卡已连接；不代表所有请求均已接管",
        ),
        Some(true) => (
            "unknown",
            "运行中内核已启用 TUN，但尚未确认匹配的 Windows 网卡已连接",
        ),
        None => ("unknown", "未取得运行中内核 TUN 配置，无法确认启用状态"),
    };
    let mut check = item("tun", "TUN 网卡", status, detail);
    check.evidence = Some(
        serde_json::json!({"enabled":enabled,"device":device,"adapters":adapters}).to_string(),
    );
    check
}

pub async fn diagnose(profile: Option<&Value>) -> Vec<Check> {
    diagnose_selected(profile, None).await
}
pub async fn diagnose_one(profile: Option<&Value>, id: &str) -> Check {
    diagnose_selected(profile, Some(id))
        .await
        .into_iter()
        .find(|c| c.id == id)
        .unwrap_or_else(|| {
            item(
                id,
                id,
                "unknown",
                "检测未取得结果，请检查配置；无法确认运行状态",
            )
        })
}
async fn diagnose_selected(profile: Option<&Value>, selected: Option<&str>) -> Vec<Check> {
    let mut out = if selected.is_none_or(|id| {
        matches!(
            id,
            "clash" | "clash_nodes" | "clash_policy" | "sg_node" | "tun"
        )
    }) {
        clash(profile).await
    } else {
        vec![]
    };
    if selected.is_none_or(|id| id == "tun") && !out.iter().any(|c| c.id == "tun") {
        out.push(tun_check(None, None));
    }
    let recovery = super::cli::recovery_state();
    out.push(item(
        "config_recovery",
        "Claude 配置快照与恢复",
        if recovery == "clean" {
            "not_applicable"
        } else {
            "unknown"
        },
        match recovery {
            "clean" => "没有待恢复的 Claude 配置快照",
            "pending_restore" => {
                "存在 DPAPI 配置快照；若上次异常退出，可通过恢复入口仅还原受管字段"
            }
            _ => "配置快照与当前字段冲突或不可读；停止覆盖，保留加密备份",
        },
    ));
    let local = if selected.is_none_or(|id| {
        matches!(
            id,
            "timezone"
                | "system_proxy"
                | "tun"
                | "local_ipv6"
                | "local_dns"
                | "windows_environment"
        )
    }) {
        tokio::task::spawn_blocking(|| {
        super::cli::hidden("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", r#"$ErrorActionPreference='Stop'; $p=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'; [pscustomobject]@{timezone=(Get-TimeZone).Id;systemProxyEnabled=$p.ProxyEnable;systemProxy=$p.ProxyServer;ipv6DefaultRoutes=@(Get-NetRoute -AddressFamily IPv6 -DestinationPrefix '::/0' -ErrorAction SilentlyContinue).Count;ipv6Enabled=@(Get-NetAdapterBinding -ComponentID ms_tcpip6 | Where-Object Enabled).Count;dns=@(Get-DnsClientServerAddress | Where-Object {$_.ServerAddresses.Count -gt 0} | ForEach-Object {$_.ServerAddresses})} | ConvertTo-Json -Compress"#]).output().ok().filter(|o| o.status.success()).and_then(|o| serde_json::from_slice::<Value>(&o.stdout).ok())
    }).await.ok().flatten()
    } else {
        None
    };
    if let Some(v) = local {
        for (id, label, status, detail) in [
            (
                "timezone",
                "系统时区",
                if v["timezone"] == "China Standard Time"
                    || v["timezone"] == "Singapore Standard Time"
                {
                    "pass"
                } else {
                    "warning"
                },
                format!("{}；SG 与中国均 UTC+8，不修改系统时区", v["timezone"]),
            ),
            (
                "system_proxy",
                "当前系统代理",
                if v["systemProxyEnabled"] == 1
                    && v["systemProxy"].as_str().is_some_and(|s| !s.is_empty())
                {
                    "pass"
                } else {
                    "warning"
                },
                format!(
                    "启用={}，地址={}；系统代理不证明受管请求命中",
                    v["systemProxyEnabled"], v["systemProxy"]
                ),
            ),
            (
                "local_ipv6",
                "IPv6 旁路风险",
                "unknown",
                format!(
                    "启用绑定={}，默认路由={}；未全局禁用 IPv6，未证明无旁路",
                    v["ipv6Enabled"], v["ipv6DefaultRoutes"]
                ),
            ),
            (
                "local_dns",
                "本机 DNS 路径",
                "unknown",
                format!(
                    "配置的解析器={}；远端解析与实际请求路径尚不可确认",
                    v["dns"]
                ),
            ),
        ] {
            out.push(item(id, label, status, detail));
        }
    } else {
        out.push(item(
            "windows_environment",
            "Windows 环境",
            "unknown",
            "本机只读查询未完成",
        ));
    }
    out.push(item(
        "sg_profile",
        "SG 区域 Profile",
        if profile.is_some_and(|p| p.is_object()) {
            "unknown"
        } else {
            "unknown"
        },
        profile
            .filter(|p| p.is_object())
            .map(|p| {
                format!(
                    "注册地区={}，运行地区={}，目标节点={}，预期 IPv4={}，版本={}；未初始化",
                    p["registration_region"],
                    p["region"],
                    p["clash_node"],
                    p["expected_egress_ipv4"],
                    p["version"]
                )
            })
            .unwrap_or_else(|| {
                if super::sg::summary()
                    .ok()
                    .is_some_and(|s| s["configured"] == true)
                {
                    "已配置本地 SS 节点；可在此测试出口。云端区域策略尚未同步，不影响本地节点测试"
                        .into()
                } else {
                    "未配置 SG 节点；在下方导入 SS 链接即可开始本地出口测试，无需云端登录".into()
                }
            }),
    ));
    out.push(item(
        "server_egress",
        "B 段：Sub2API → 上游",
        "unknown",
        "尚无服务器侧实际出口证据；客户端 IP 探针不能替代服务端核验",
    ));
    out.push(item(
        "initialization",
        "SG 初始化与恢复",
        "unknown",
        "尚未接管 Clash；未写入规则或订阅，没有可恢复的 SG 改动。受管 API 仍使用原服务专属代理",
    ));
    if profile.is_none_or(|p| !p.is_object()) {
        out.push(item(
            "webrtc",
            "WebRTC / STUN",
            "not_applicable",
            "纯 CLI 没有浏览器 WebRTC API；未修改浏览器策略",
        ));
        out.push(item(
            "udp",
            "UDP 路径",
            "unknown",
            "基础检测未验证 UDP 出口，不宣称受保护",
        ));
        out.push(item(
            "kill_switch",
            "已保护请求断线阻断",
            "unknown",
            "未激活的本机检测不能证明 API 断线阻断；非 API 网络层仍未覆盖",
        ));
    }
    out
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "read-only live Windows/CFW evidence"]
    fn live_environment() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let checks = rt.block_on(diagnose(None));
        println!("{}", serde_json::to_string_pretty(&checks).unwrap());
        assert!(checks.iter().any(|c| c.id == "clash"));
        assert!(checks
            .iter()
            .any(|c| c.id == "server_egress" && c.status == "unknown"));
    }
    #[test]
    fn rejects_duplicate_or_nested_controller() {
        assert_eq!(
            scalar("  external-controller: remote:80", "external-controller"),
            None
        );
        assert_eq!(scalar("secret: a\nsecret: b", "secret"), None);
        assert_eq!(scalar("secret: 'value'", "secret"), Some("value".into()));
    }
}

#[cfg(test)]
mod tun_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn runtime_tun_requires_enabled_core_and_connected_interface() {
        let adapter =
            json!({"Name":"custom-tun","InterfaceDescription":"Virtual adapter","Status":"Up"});
        let enabled = json!({"tun":{"enable":true,"device":"custom-tun"}});
        assert_eq!(tun_check(Some(&enabled), Some(&adapter)).status, "pass");
        let disabled = json!({"tun":{"enable":false}});
        assert_eq!(tun_check(Some(&disabled), Some(&adapter)).status, "warning");
        assert_eq!(
            tun_check(Some(&enabled), Some(&json!([]))).status,
            "unknown"
        );
        assert_eq!(tun_check(None, Some(&adapter)).status, "unknown");
        let disconnected = json!([{"Name":"custom-tun","Status":"Disconnected"}]);
        assert_eq!(
            tun_check(Some(&enabled), Some(&disconnected)).status,
            "unknown"
        );
    }
}

//! P1 entry point. Upstream provider import/export and update startup are not run.
mod cli;
mod network;
mod shell;
mod vault;

use crate::proxy::{self, AppTarget, ProxyControl, ProxyHandle, ProxyRuntimeConfig};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

const SESSION: &str = "session.dpapi";
const PORT: u16 = 18899;

#[derive(Clone, Serialize, Deserialize)]
struct Session {
    server: String,
    access: String,
    refresh: String,
    service_id: Option<i64>,
    #[serde(default)]
    expires_at: u64,
}
#[derive(Default)]
struct Runtime {
    session: Option<Session>,
    services: Vec<Value>,
    network: Option<Value>,
    child: Option<std::process::Child>,
}
struct Desktop {
    inner: tokio::sync::Mutex<Runtime>,
    control: tokio::sync::Mutex<ProxyControl>,
    proxy: ProxyHandle,
    client: reqwest::Client,
    prefs: std::sync::Mutex<shell::Prefs>,
}
impl Desktop {
    fn new() -> Self {
        let proxy = ProxyHandle::default();
        Self {
            inner: tokio::sync::Mutex::new(Runtime::default()),
            control: tokio::sync::Mutex::new(ProxyControl::new(proxy.clone())),
            proxy,
            prefs: std::sync::Mutex::new(shell::load()),
            client: reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(30))
                .user_agent("CodeSeam-Desktop/0.5.0")
                .build()
                .expect("HTTP client"),
        }
    }
    async fn stop(&self) {
        proxy::clear_target(&self.proxy.targets, "claude");
        self.control.lock().await.stop();
    }
    async fn api(&self, s: &Session, path: &str, body: Option<Value>) -> Result<Value, String> {
        let url = format!("{}/api/v1{path}", s.server);
        let req = if let Some(body) = body {
            self.client.post(&url).json(&body)
        } else {
            self.client.get(&url)
        };
        let response = req
            .bearer_auth(&s.access)
            .send()
            .await
            .map_err(|_| "CLOUD_UNREACHABLE：云端不可达，请检查服务地址与网络")?;
        let status = response.status();
        let data: Value = response
            .json()
            .await
            .map_err(|_| "云端返回非 JSON 响应，请核对主服务地址")?;
        if !status.is_success() || data["code"] != 0 {
            // Never relay server-provided error text, which may contain credentials.
            return Err(format!(
                "云端请求失败 HTTP {}（{}）；认证失效请重新登录，服务无效请联系运营",
                status.as_u16(),
                path
            ));
        }
        Ok(data["data"].clone())
    }
    async fn services(&self, r: &mut Runtime) -> Result<(), String> {
        self.stop().await;
        r.network = None;
        let s = r.session.as_mut().ok_or("请先登录")?;
        self.renew(s, false).await?;
        let data = self.api(s, "/codeseam/service/current", None).await?;
        r.services = data["services"].as_array().ok_or("服务响应不兼容")?.clone();
        Ok(())
    }
    async fn activate(&self, r: &mut Runtime, id: i64) -> Result<(), String> {
        self.stop().await;
        r.network = None;
        let s = r.session.as_mut().ok_or("请先登录")?;
        self.renew(s, false).await?;
        let data = self
            .api(
                s,
                "/codeseam/client/activate",
                Some(json!({"service_id":id})),
            )
            .await?;
        let key = data["api_key"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or("缺少受管授权")?;
        let network = self
            .api(
                s,
                "/codeseam/client/network-config",
                Some(json!({"service_id":id})),
            )
            .await?;
        if network["service_id"].as_i64() != Some(id)
            || network["revision"]
                .as_str()
                .filter(|v| !v.is_empty())
                .is_none()
            || network["revision"] != data["network_revision"]
        {
            return Err("服务网络配置已变化，请重新连接".into());
        }
        let assigned_proxy = network::assigned_proxy_url(&network)
            .ok_or("服务未下发受支持的 HTTP(S) 专属代理，已拒绝直连降级")?;
        let config = ProxyRuntimeConfig {
            managed_only: true,
            error_log_enabled: false,
            ..Default::default()
        };
        self.control.lock().await.start(PORT, config).await?;
        proxy::set_target(
            &self.proxy.targets,
            "claude",
            AppTarget {
                base_url: s.server.clone(),
                headers: vec![("x-api-key".into(), key.into())],
                proxy: Some(assigned_proxy),
            },
        );
        r.network = Some(network);
        s.service_id = Some(id);
        if let Err(e) = save(s) {
            self.stop().await;
            return Err(e);
        }
        Ok(())
    }
    async fn renew(&self, s: &mut Session, force: bool) -> Result<(), String> {
        if !force && now() < s.expires_at {
            return Ok(());
        }
        if s.refresh.is_empty() {
            return Err("登录会话已过期，请重新登录".into());
        }
        let data = self
            .api(s, "/auth/refresh", Some(json!({"refresh_token":s.refresh})))
            .await?;
        s.access = data["access_token"].as_str().ok_or("刷新会话失败")?.into();
        s.refresh = data["refresh_token"].as_str().ok_or("刷新会话失败")?.into();
        s.expires_at = expiry(&data);
        save(s)
    }
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn expiry(data: &Value) -> u64 {
    now()
        + data["expires_in"]
            .as_u64()
            .unwrap_or(300)
            .saturating_sub(30)
}
fn save(s: &Session) -> Result<(), String> {
    vault::save(SESSION, &serde_json::to_vec(s).map_err(|e| e.to_string())?)
}
fn server_url(raw: &str) -> Result<String, String> {
    let u = reqwest::Url::parse(raw.trim()).map_err(|_| "服务地址无效")?;
    let local = matches!(u.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    if !(u.scheme() == "https" || (u.scheme() == "http" && local))
        || !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
        || u.path() != "/"
    {
        return Err("请填写 HTTPS 服务根地址；HTTP 仅允许本机开发服务".into());
    }
    Ok(u.as_str().trim_end_matches('/').into())
}
#[tauri::command]
async fn cs_login(
    state: State<'_, Desktop>,
    server: String,
    email: String,
    password: String,
) -> Result<Value, String> {
    let mut r = state.inner.lock().await;
    state.stop().await;
    r.session = None;
    r.services.clear();
    r.network = None;
    vault::remove(SESSION)?;
    let mut s = Session {
        server: server_url(&server)?,
        access: String::new(),
        refresh: String::new(),
        service_id: None,
        expires_at: 0,
    };
    let data = state
        .api(
            &s,
            "/auth/login",
            Some(json!({"email":email,"password":password})),
        )
        .await?;
    s.access = data["access_token"]
        .as_str()
        .ok_or("此账号需要验证码或双因素认证，请使用当前 P1 支持的密码登录测试账号")?
        .into();
    s.refresh = data["refresh_token"].as_str().unwrap_or("").into();
    s.expires_at = expiry(&data);
    save(&s)?;
    r.session = Some(s);
    state.services(&mut r).await?;
    Ok(status(&state, &mut r))
}
#[tauri::command]
async fn cs_resume(state: State<'_, Desktop>) -> Result<Value, String> {
    let mut r = state.inner.lock().await;
    if r.session.is_none() {
        if let Some(bytes) = vault::read(SESSION)? {
            let mut s: Session =
                serde_json::from_slice(&bytes).map_err(|_| "会话不可读，请重新登录")?;
            state.renew(&mut s, true).await?;
            let id = s.service_id;
            r.session = Some(s);
            state.services(&mut r).await?;
            let auto_connect = state.prefs.lock().unwrap().auto_connect;
            if let Some(id) = id.filter(|_| auto_connect) {
                state.activate(&mut r, id).await?;
            }
        }
    }
    Ok(status(&state, &mut r))
}
// Explicit allowlist: credentials stay in Rust memory, never in React/status/DPAPI.
fn network_summary(v: &Value) -> Value {
    json!({"revision":v["revision"], "expected_egress":v["expected_egress"],
        "expires_at":v["expires_at"], "proxy_expires_at":v["proxy_expires_at"],
        "protocol":v["proxy"]["protocol"], "egress_verified":false})
}

fn report_context(state: &Desktop, r: &Runtime) -> Option<network::Context> {
    let network = r.network.as_ref()?;
    Some(network::Context {
        local_port: PORT,
        server_url: r.session.as_ref()?.server.clone(),
        expected_egress: network["expected_egress"].as_str().map(str::to_owned),
        assigned_proxy: network::assigned_proxy_url(network),
        proxy_running: state.proxy.is_running(),
        cli_configured: cli::configured(PORT),
    })
}
fn status(state: &Desktop, r: &mut Runtime) -> Value {
    let pid = r.child.as_mut().and_then(|c| {
        if c.try_wait().ok().flatten().is_none() {
            Some(c.id())
        } else {
            None
        }
    });
    json!({"logged_in":r.session.is_some(),"server":r.session.as_ref().map(|s|&s.server),"services":r.services,
        "service_id":r.session.as_ref().and_then(|s|s.service_id),"proxy_running":state.proxy.is_running(),"local_url":proxy::local_base(PORT,"claude"),
        "network":r.network.as_ref().map(network_summary),"configured":cli::configured(PORT),"cli":cli::detect(),"cli_pid":pid,"requests":state.proxy.counters("claude").map(|c|c.total())})
}
#[tauri::command]
async fn cs_status(state: State<'_, Desktop>) -> Result<Value, String> {
    let mut r = state.inner.lock().await;
    Ok(status(&state, &mut r))
}

/// 已保存的客户端偏好设置，以及设置页展示的只读信息。
fn prefs_view(prefs: &shell::Prefs) -> Value {
    let mut v = serde_json::to_value(prefs).unwrap_or_else(|_| json!({}));
    v["tray"] = json!(shell::tray_ready());
    v["data_dir"] = json!(vault::dir().ok().map(|p| p.display().to_string()));
    v
}
#[tauri::command]
fn cs_prefs_get(state: State<'_, Desktop>) -> Value {
    prefs_view(&state.prefs.lock().unwrap())
}
#[tauri::command]
fn cs_prefs_set(state: State<'_, Desktop>, prefs: shell::Prefs) -> Result<Value, String> {
    let prefs = shell::checked(prefs)?;
    shell::save(&prefs)?;
    *state.prefs.lock().unwrap() = prefs;
    Ok(prefs_view(&state.prefs.lock().unwrap()))
}
/// 在资源管理器中打开固定目录之一（`claude`、`data`、`work` 或 `license`）；WebView 不会传入路径。
#[tauri::command]
fn cs_open_path(app: AppHandle, state: State<'_, Desktop>, kind: String) -> Result<(), String> {
    let prefs = state.prefs.lock().unwrap().clone();
    shell::reveal(&shell::folder(&app, &kind, &prefs)?)
}

#[tauri::command]
async fn cs_cli_info() -> Result<Value, String> {
    tokio::task::spawn_blocking(cli::info)
        .await
        .map_err(|e| e.to_string())
}

fn valid_range(start: &str, end: &str) -> Result<(), String> {
    let valid = |s: &str| {
        s.len() == 10
            && s.bytes().enumerate().all(|(i, b)| {
                if i == 4 || i == 7 {
                    b == b'-'
                } else {
                    b.is_ascii_digit()
                }
            })
    };
    if !valid(start) || !valid(end) || start > end {
        return Err("请选择有效日期范围".into());
    }
    Ok(())
}

#[tauri::command]
async fn cs_usage(state: State<'_, Desktop>, start: String, end: String) -> Result<Value, String> {
    valid_range(&start, &end)?;
    let mut r = state.inner.lock().await;
    let s = r.session.as_mut().ok_or("请先登录")?;
    state.renew(s, false).await?;
    state
        .api(
            s,
            &format!("/usage/stats?start_date={start}&end_date={end}"),
            None,
        )
        .await
}

/// 每页读取的请求记录数量；最多读取 `REPORT_PAGES` 页。
const REPORT_PAGE_SIZE: usize = 1000;
const REPORT_PAGES: usize = 5;

/// 用量页面使用的报告，包含汇总统计、每日趋势、模型分布和当前用户的请求记录。
/// 请求记录只保留界面所需字段，不会将 IP 地址、用户代理或端点详情传给 WebView。
#[tauri::command]
async fn cs_usage_report(
    state: State<'_, Desktop>,
    start: String,
    end: String,
) -> Result<Value, String> {
    valid_range(&start, &end)?;
    let mut r = state.inner.lock().await;
    let s = r.session.as_mut().ok_or("请先登录")?;
    state.renew(s, false).await?;
    let q = format!("start_date={start}&end_date={end}");
    let stats = state.api(s, &format!("/usage/stats?{q}"), None).await?;
    let snap = state
        .api(
            s,
            &format!("/usage/dashboard/snapshot-v2?{q}&granularity=day&include_trend=true&include_model_stats=true"),
            None,
        )
        .await?;
    let mut logs: Vec<Value> = Vec::new();
    let mut total: u64 = 0;
    for page in 1..=REPORT_PAGES {
        let p = state
            .api(
                s,
                &format!("/usage?{q}&page={page}&page_size={REPORT_PAGE_SIZE}"),
                None,
            )
            .await?;
        total = p["total"].as_u64().unwrap_or(0);
        if let Some(items) = p["items"].as_array() {
            logs.extend(items.iter().map(|i| {
                json!({
                    "id": i["id"], "request_id": i["request_id"], "session_id": i["session_id"],
                    "model": i["model"], "input_tokens": i["input_tokens"],
                    "output_tokens": i["output_tokens"],
                    "cache_creation_tokens": i["cache_creation_tokens"],
                    "cache_read_tokens": i["cache_read_tokens"],
                    "total_cost": i["total_cost"], "actual_cost": i["actual_cost"],
                    "duration_ms": i["duration_ms"], "first_token_ms": i["first_token_ms"],
                    "stream": i["stream"], "created_at": i["created_at"]
                })
            }));
        }
        if page as u64 >= p["pages"].as_u64().unwrap_or(1) {
            break;
        }
    }
    Ok(json!({
        "start": start, "end": end, "stats": stats, "trend": snap["trend"],
        "models": snap["models"], "logs": logs, "logs_total": total,
        "truncated": total > logs.len() as u64
    }))
}

#[tauri::command]
fn cs_open_portal(url: String) -> Result<(), String> {
    let u = reqwest::Url::parse(&url).map_err(|_| "门户地址无效")?;
    let origin = u.origin().ascii_serialization();
    server_url(&origin)?;
    if !u.username().is_empty() || u.password().is_some() {
        return Err("门户地址不能含凭据".into());
    }
    cli::hidden("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", u.as_str()])
        .spawn()
        .map_err(|_| "无法打开门户")?;
    Ok(())
}

fn stop_child(r: &mut Runtime) {
    if let Some(c) = r.child.as_mut() {
        if c.try_wait().ok().flatten().is_none() {
            let _ = cli::hidden("taskkill.exe")
                .args(["/PID", &c.id().to_string(), "/T", "/F"])
                .output();
        }
    }
    r.child = None;
}

pub fn uninstall() -> Result<(), String> {
    // Preserve the encrypted backup if drift prevents a safe restoration.
    cli::restore()?;
    vault::remove(SESSION)
}

/// 运行一次真实网络探针。公网专属出口、DNS 远端解析和非 API 进程规则
/// 都按证据分别报告；缺少证据时返回 unknown/not_covered。
#[tauri::command]
async fn cs_diagnose(state: State<'_, Desktop>) -> Result<network::Report, String> {
    let r = state.inner.lock().await;
    let context = report_context(&state, &r).ok_or("请先登录并激活服务")?;
    drop(r);
    Ok(network::diagnose(context).await)
}
#[tauri::command]
async fn cs_refresh(state: State<'_, Desktop>) -> Result<Value, String> {
    let mut r = state.inner.lock().await;
    let id = r.session.as_ref().and_then(|s| s.service_id);
    state.services(&mut r).await?;
    if let Some(id) = id {
        state.activate(&mut r, id).await?;
    }
    Ok(status(&state, &mut r))
}
#[tauri::command]
async fn cs_activate(state: State<'_, Desktop>, id: i64) -> Result<Value, String> {
    let mut r = state.inner.lock().await;
    state.activate(&mut r, id).await?;
    Ok(status(&state, &mut r))
}
#[tauri::command]
async fn cs_configure(state: State<'_, Desktop>, confirmed: bool) -> Result<(), String> {
    if !confirmed {
        return Err("需用户确认备份并配置 localhost".into());
    }
    if !state.proxy.is_running() {
        return Err("请先激活服务".into());
    }
    cli::configure(PORT)
}

/// 受用户确认的环境修复：只恢复 CodeSeam 托管的 Claude API 字段，
/// 先在 DPAPI 中保留原始配置；不静默修改系统 DNS、IPv6 或全局防火墙。
#[tauri::command]
async fn cs_repair_environment(state: State<'_, Desktop>, confirmed: bool) -> Result<(), String> {
    if !confirmed {
        return Err("环境修复需要确认：仅修改 Claude API 地址/授权，并保留原始配置备份".into());
    }
    if !state.proxy.is_running() {
        return Err("受管代理未运行，拒绝写入会导致直连的配置".into());
    }
    cli::configure(PORT)
}
#[tauri::command]
async fn cs_restore(state: State<'_, Desktop>) -> Result<(), String> {
    let mut r = state.inner.lock().await;
    if r.child
        .as_mut()
        .is_some_and(|c| c.try_wait().ok().flatten().is_none())
    {
        return Err("请先关闭受管 Claude 终端再恢复配置".into());
    }
    cli::restore()
}
#[tauri::command]
async fn cs_launch(state: State<'_, Desktop>) -> Result<(), String> {
    let mut r = state.inner.lock().await;
    if r.child
        .as_mut()
        .is_some_and(|c| c.try_wait().ok().flatten().is_none())
    {
        return Err("Claude 终端已运行，请先关闭".into());
    }
    let id = r
        .session
        .as_ref()
        .and_then(|s| s.service_id)
        .ok_or("请先激活服务")?;
    state.activate(&mut r, id).await?;
    let context = report_context(&state, &r).ok_or("网络配置不可用，已拒绝启动")?;
    let launch_proxy = context.assigned_proxy.clone();
    let report = network::diagnose(context).await;
    if !report.can_start {
        state.stop().await;
        r.network = None;
        return Err("网络诊断存在会导致受保护 API 直连的失败项；已保持 Kill-Switch 拒绝状态，请先修复并重新检测".into());
    }
    let work_dir = state.prefs.lock().unwrap().work_dir.clone();
    r.child = Some(cli::launch(PORT, launch_proxy.as_deref(), &work_dir)?);
    Ok(())
}
#[tauri::command]
async fn cs_stop(state: State<'_, Desktop>) -> Result<(), String> {
    let mut r = state.inner.lock().await;
    if let Some(c) = r.child.as_mut() {
        if c.try_wait().map_err(|e| e.to_string())?.is_none() {
            let out = cli::hidden("taskkill.exe")
                .args(["/PID", &c.id().to_string(), "/T", "/F"])
                .output()
                .map_err(|e| e.to_string())?;
            if !out.status.success() {
                return Err("关闭受管 Claude 失败，请手工关闭终端".into());
            }
        }
    }
    r.child = None;
    Ok(())
}
#[tauri::command]
async fn cs_disconnect(state: State<'_, Desktop>) -> Result<(), String> {
    let mut r = state.inner.lock().await;
    state.stop().await;
    r.network = None;
    Ok(())
}
#[tauri::command]
async fn cs_logout(state: State<'_, Desktop>) -> Result<(), String> {
    let mut r = state.inner.lock().await;
    state.stop().await;
    stop_child(&mut r);
    cli::restore()?;
    if let Some(s) = r.session.take() {
        let _ = state
            .api(&s, "/auth/logout", Some(json!({"refresh_token":s.refresh})))
            .await;
    }
    r.services.clear();
    r.network = None;
    vault::remove(SESSION)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            shell::show_main(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(Desktop::new())
        .setup(|app| {
            // 托盘图标创建失败时仅禁用“关闭到托盘”，不能阻止客户端启动。
            if let Err(e) = shell::setup_tray(app.handle()) {
                eprintln!("[codeseam] tray unavailable: {e}");
            }
            if app.state::<Desktop>().prefs.lock().unwrap().start_minimized {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.minimize();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let to_tray = window.state::<Desktop>().prefs.lock().unwrap().close_to_tray;
                if to_tray && shell::tray_ready() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            cs_login,
            cs_resume,
            cs_status,
            cs_cli_info,
            cs_prefs_get,
            cs_prefs_set,
            cs_open_path,
            cs_usage,
            cs_usage_report,
            cs_open_portal,
            cs_diagnose,
            cs_refresh,
            cs_activate,
            cs_configure,
            cs_repair_environment,
            cs_restore,
            cs_launch,
            cs_stop,
            cs_disconnect,
            cs_logout
        ])
        .build(tauri::generate_context!())
        .expect("CodeSeam 启动失败")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<Desktop>();
                tauri::async_runtime::block_on(async {
                    state.stop().await;
                    stop_child(&mut *state.inner.lock().await);
                });
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn network_status_does_not_disclose_credentials() {
        let v = json!({"revision":"v1","expected_egress":"192.0.2.1", "proxy":{"protocol":"http", "host":"private-host", "username":"private-user", "password":"private-password"}});
        let summary = network_summary(&v).to_string();
        assert!(!summary.contains("private-"));
        assert!(summary.contains("192.0.2.1"));
    }
    #[test]
    fn rejects_unsafe_cloud_urls() {
        for u in [
            "http://example.com",
            "https://user:pass@example.com",
            "https://example.com/api",
            "https://example.com/?key=secret",
        ] {
            assert!(server_url(u).is_err());
        }
        assert!(server_url("http://127.0.0.1:18080").is_ok());
        assert!(server_url("https://example.com").is_ok());
    }
}

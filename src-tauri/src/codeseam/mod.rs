//! P1 entry point. Upstream provider import/export and update startup are not run.
mod cli;
mod vault;

use crate::proxy::{self, AppTarget, ProxyControl, ProxyHandle, ProxyRuntimeConfig};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{Manager, State};

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
    child: Option<std::process::Child>,
}
struct Desktop {
    inner: tokio::sync::Mutex<Runtime>,
    control: tokio::sync::Mutex<ProxyControl>,
    proxy: ProxyHandle,
    client: reqwest::Client,
}
impl Desktop {
    fn new() -> Self {
        let proxy = ProxyHandle::default();
        Self {
            inner: tokio::sync::Mutex::new(Runtime::default()),
            control: tokio::sync::Mutex::new(ProxyControl::new(proxy.clone())),
            proxy,
            client: reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(30))
                .user_agent("CodeSeam-Desktop-P1")
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
        let s = r.session.as_mut().ok_or("请先登录")?;
        self.renew(s, false).await?;
        let data = self.api(s, "/codeseam/service/current", None).await?;
        r.services = data["services"].as_array().ok_or("服务响应不兼容")?.clone();
        Ok(())
    }
    async fn activate(&self, r: &mut Runtime, id: i64) -> Result<(), String> {
        self.stop().await;
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
                proxy: None,
            },
        );
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
            if let Some(id) = id {
                state.activate(&mut r, id).await?;
            }
        }
    }
    Ok(status(&state, &mut r))
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
        "configured":cli::configured(PORT),"cli":cli::detect(),"cli_pid":pid,"requests":state.proxy.counters("claude").map(|c|c.total())})
}
#[tauri::command]
async fn cs_status(state: State<'_, Desktop>) -> Result<Value, String> {
    let mut r = state.inner.lock().await;
    Ok(status(&state, &mut r))
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
    r.child = Some(cli::launch(PORT)?);
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
    state.stop().await;
    Ok(())
}
#[tauri::command]
async fn cs_logout(state: State<'_, Desktop>) -> Result<(), String> {
    let mut r = state.inner.lock().await;
    state.stop().await;
    if let Some(s) = r.session.take() {
        let _ = state
            .api(&s, "/auth/logout", Some(json!({"refresh_token":s.refresh})))
            .await;
    }
    r.services.clear();
    vault::remove(SESSION)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .manage(Desktop::new())
        .invoke_handler(tauri::generate_handler![
            cs_login,
            cs_resume,
            cs_status,
            cs_refresh,
            cs_activate,
            cs_configure,
            cs_restore,
            cs_launch,
            cs_stop,
            cs_disconnect,
            cs_logout
        ])
        .run(tauri::generate_context!())
        .expect("CodeSeam 启动失败");
}

#[cfg(test)]
mod tests {
    use super::*;
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

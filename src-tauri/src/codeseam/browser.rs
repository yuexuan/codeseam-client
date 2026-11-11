//! 独立的 Chromium 会话；所有证据均在实际浏览器中采集。
use super::{network::Check, vault};
mod firefox;
use firefox::{firefox_observe, launch_firefox};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::Duration,
};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default = "default_browser")]
    browser_id: String,
    proxy: String,
    expected_ip: String,
    language: String,
    timezone: String,
    width: u32,
    height: u32,
    cores: u32,
    block_webrtc: bool,
}
fn default_browser() -> String {
    "chrome".into()
}
fn browser_id_valid(id: &str) -> bool {
    matches!(id, "chrome" | "edge" | "firefox")
}
impl Default for Config {
    fn default() -> Self {
        Self {
            browser_id: default_browser(),
            proxy: "http://127.0.0.1:7890".into(),
            expected_ip: String::new(),
            language: "en-SG".into(),
            timezone: "Asia/Singapore".into(),
            width: 1366,
            height: 768,
            cores: 8,
            block_webrtc: false,
        }
    }
}
impl Config {
    fn validate(&self) -> Result<(), String> {
        if !browser_id_valid(&self.browser_id) {
            return Err("不支持的浏览器".into());
        }
        let u = reqwest::Url::parse(&self.proxy).map_err(|_| "代理地址无效")?;
        if !matches!(u.scheme(), "http" | "https")
            || u.host_str().is_none()
            || u.port_or_known_default() == Some(0)
            || !u.username().is_empty()
            || u.password().is_some()
            || u.path() != "/"
            || u.query().is_some()
            || u.fragment().is_some()
        {
            return Err("请填写无认证的 HTTP(S) 代理根地址；本机 Clash HTTP / mixed 端口可用。18899/claude 是 API 网关，不能用作浏览器代理。".into());
        }
        if !self.expected_ip.is_empty() && self.expected_ip.parse::<std::net::IpAddr>().is_err() {
            return Err("预期出口 IP 无效".into());
        }
        if self.language.is_empty()
            || self.language.len() > 35
            || !self
                .language
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Err("语言须为 en-SG 等语言标签".into());
        }
        if self.timezone.is_empty() || self.timezone.len() > 80 {
            return Err("请填写 IANA 时区，例如 Asia/Singapore".into());
        }
        if !(800..=16384).contains(&self.width)
            || !(600..=16384).contains(&self.height)
            || !(1..=1024).contains(&self.cores)
        {
            return Err("屏幕宽高须为有效显示器尺寸，CPU 核心数须有效".into());
        }
        Ok(())
    }
}
struct Request {
    method: String,
    params: Value,
    session: Option<String>,
    result: oneshot::Sender<Result<Value, String>>,
}
#[derive(Clone)]
struct Cdp {
    tx: mpsc::Sender<Request>,
}
impl Cdp {
    async fn call(
        &self,
        method: &str,
        params: Value,
        session: Option<&str>,
    ) -> Result<Value, String> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(Request {
                method: method.into(),
                params,
                session: session.map(str::to_string),
                result: tx,
            })
            .await
            .map_err(|_| "浏览器连接已关闭")?;
        tokio::time::timeout(Duration::from_secs(25), rx)
            .await
            .map_err(|_| "浏览器操作超时")?
            .map_err(|_| "浏览器连接已关闭")?
    }
}
// 即使 CodeSeam 崩溃，Windows 作业对象也会关闭整个浏览器进程树。
#[cfg(windows)]
struct Job(usize);
#[cfg(windows)]
impl Job {
    fn new(child: &Child) -> Result<Self, String> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::{Foundation::CloseHandle, System::JobObjects::*};
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err("无法建立受管浏览器进程保护".into());
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(handle, child.as_raw_handle()) == 0
            {
                CloseHandle(handle);
                return Err("无法隔离浏览器进程，已拒绝启动".into());
            }
            Ok(Self(handle as usize))
        }
    }
}
#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0 as _);
        }
    }
}
struct Session {
    child: Child,
    cdp: Cdp,
    config: Config,
    errors: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
    task: tokio::task::JoinHandle<()>,
    _proxy: Option<super::sg::LocalProxy>,
    #[cfg(windows)]
    _job: Option<Job>,
}
#[derive(Clone)]
struct Probe {
    cdp: Cdp,
    config: Config,
    errors: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
}
impl Session {
    fn snapshot(&self) -> Probe {
        Probe {
            cdp: self.cdp.clone(),
            config: self.config.clone(),
            errors: self.errors.clone(),
        }
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        self.task.abort();
        if self.child.try_wait().ok().flatten().is_none() {
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let _ = Command::new("taskkill")
                    .args(["/PID", &self.child.id().to_string(), "/T", "/F"])
                    .creation_flags(0x08000000)
                    .output();
            }
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}
async fn close_session(session: &mut Option<Session>) {
    if let Some(s) = session.as_mut() {
        let method = if s.config.browser_id == "firefox" {
            "browser.close"
        } else {
            "Browser.close"
        };
        let _ =
            tokio::time::timeout(Duration::from_secs(2), s.cdp.call(method, json!({}), None)).await;
        for _ in 0..40 {
            if s.child.try_wait().ok().flatten().is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
    session.take();
}
#[derive(Default)]
pub struct BrowserState {
    session: Mutex<Option<Session>>,
}
impl BrowserState {
    pub async fn stop(&self) {
        close_session(&mut *self.session.lock().await).await;
    }
}
impl BrowserState {
    pub async fn checks(&self) -> Vec<Check> {
        let snapshot = self.session.lock().await.as_ref().map(Session::snapshot);
        let Some(s) = snapshot else { return vec![] };
        match diagnose(&s).await {
            Ok(v) => serde_json::from_value(v["checks"].clone()).unwrap_or_default(),
            Err(e) => vec![check(
                "browser_egress",
                "受管浏览器检测",
                "unknown",
                e,
                json!({}),
            )],
        }
    }
}
fn config_file(id: &str) -> String {
    format!("browser-{id}.dpapi")
}
fn report_file(id: &str) -> String {
    format!("browser-{id}-report.dpapi")
}
fn baseline_file(id: &str) -> String {
    format!("browser-{id}-baseline.dpapi")
}
fn read_json(file: &str) -> Result<Option<Value>, String> {
    vault::read(file)?
        .map(|b| {
            serde_json::from_slice(&b)
                .map_err(|_| "浏览器保存数据损坏，请保留数据并重建环境".into())
        })
        .transpose()
}
fn write_json(file: &str, value: &Value) -> Result<(), String> {
    vault::save(
        file,
        &serde_json::to_vec(value).map_err(|_| "浏览器数据编码失败")?,
    )
}
fn profile_dir(id: &str) -> Result<PathBuf, String> {
    if !browser_id_valid(id) {
        return Err("不支持的浏览器".into());
    }
    Ok(vault::dir()?.join(format!("browser-profile-{id}")))
}
fn system_proxy() -> Option<String> {
    let raw=super::cli::hidden("powershell.exe").args(["-NoProfile","-NonInteractive","-Command","$p=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; if($p.ProxyEnable -eq 1){$p.ProxyServer}"]).output().ok().filter(|o|o.status.success()).and_then(|o|String::from_utf8(o.stdout).ok())?;
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let raw = raw
        .split(';')
        .find_map(|p| p.strip_prefix("https="))
        .or_else(|| raw.split(';').find_map(|p| p.strip_prefix("http=")))
        .unwrap_or(raw);
    Some(if raw.contains("://") {
        raw.into()
    } else {
        format!("http://{raw}")
    })
}
impl BrowserState {
    pub async fn diagnose_one(&self, id: &str) -> Result<Check, String> {
        let snapshot = self.session.lock().await.as_ref().map(Session::snapshot);
        let Some(s) = snapshot else {
            for browser in ["chrome", "edge", "firefox"] {
                if let Some(report) = read_json(&report_file(browser))? {
                    let checks: Vec<Check> =
                        serde_json::from_value(report["checks"].clone()).unwrap_or_default();
                    if let Some(mut c) = checks.into_iter().find(|c| c.id == id) {
                        c.detail = format!("上次检测 · {}", c.detail);
                        return Ok(c);
                    }
                }
            }
            return Ok(check(
                id,
                id,
                "not_created",
                "请先创建浏览器环境".into(),
                json!({}),
            ));
        };
        let r = diagnose_selected(&s, Some(id)).await?;
        let mut c: Check =
            serde_json::from_value(r["checks"][0].clone()).map_err(|_| "浏览器未返回检测结果")?;
        if id == "browser_ipv6" && c.status != "fail" {
            if let Some(v) = super::system_network::inspect_ipv6().await.ok() {
                if let Some(system) = super::system_network::checks(&v)
                    .into_iter()
                    .find(|c| c.id == "local_ipv6")
                {
                    c.status = system.status;
                    c.detail = system.detail;
                    c.evidence = system.evidence;
                    let mut report = read_json(&report_file(&s.config.browser_id))?.unwrap();
                    if let Some(checks) = report["checks"].as_array_mut() {
                        if let Some(old) = checks.iter_mut().find(|v| v["id"] == id) {
                            *old = json!(c);
                        }
                    }
                    write_json(&report_file(&s.config.browser_id), &report)?;
                }
            }
        }
        Ok(c)
    }
}
fn saved_for(id: &str) -> Result<Config, String> {
    if !browser_id_valid(id) {
        return Err("不支持的浏览器".into());
    }
    let bytes = vault::read(&config_file(id))?.or(if id == "chrome" {
        vault::read("browser.dpapi")?
    } else {
        None
    });
    if let Some(bytes) = bytes {
        let mut c: Config = serde_json::from_slice(&bytes).map_err(|_| "已保存浏览器配置损坏")?;
        c.browser_id = id.into();
        return Ok(c);
    }
    let mut c = Config::default();
    c.browser_id = id.into();
    c.proxy = system_proxy().unwrap_or_default();
    c.block_webrtc = true;
    c.cores = std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(8);
    if let Some(v)=super::cli::hidden("powershell.exe").args(["-NoProfile","-NonInteractive","-Command","Add-Type -AssemblyName System.Windows.Forms; $s=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; @{width=$s.Width;height=$s.Height}|ConvertTo-Json -Compress"]).output().ok().filter(|o|o.status.success()).and_then(|o|serde_json::from_slice::<Value>(&o.stdout).ok()) {
        if let (Some(w),Some(h))=(v["width"].as_u64(),v["height"].as_u64()){if w>=800&&h>=600{c.width=w as u32;c.height=h as u32;}}
    }
    Ok(c)
}
fn executable_for(id: &str) -> Result<PathBuf, String> {
    if !browser_id_valid(id) {
        return Err("不支持的浏览器".into());
    }
    let suffix = match id {
        "chrome" => "Google/Chrome/Application/chrome.exe",
        "edge" => "Microsoft/Edge/Application/msedge.exe",
        _ => "Mozilla Firefox/firefox.exe",
    };
    for root in [
        std::env::var_os("PROGRAMFILES"),
        std::env::var_os("PROGRAMFILES(X86)"),
        std::env::var_os("LOCALAPPDATA"),
    ]
    .into_iter()
    .flatten()
    {
        let p = PathBuf::from(root).join(suffix);
        if p.is_file() {
            return Ok(p);
        }
    }
    // App Paths 可查找安装在标准目录之外或仅对当前用户安装的浏览器。
    let name = match id {
        "chrome" => "chrome.exe",
        "edge" => "msedge.exe",
        _ => "firefox.exe",
    };
    let script=format!("foreach($r in @('HKCU:','HKLM:')){{$p=Get-ItemProperty ($r+'\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{name}') -ErrorAction SilentlyContinue;if($p){{$p.'(default)';break}}}}");
    if let Some(path) = super::cli::hidden("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
    {
        let p = PathBuf::from(path.trim().trim_matches('"'));
        if p.is_file() {
            return Ok(p);
        }
    }
    Err("此浏览器未安装，请先安装后重试".into())
}
fn installed() -> Value {
    json!(["chrome", "edge", "firefox"]
        .map(|id| json!({"id":id,"installed":executable_for(id).is_ok()})))
}
async fn launch(config: Config) -> Result<Session, String> {
    config.validate()?;
    if config.browser_id == "firefox" {
        return launch_firefox(config).await;
    }
    let profile = profile_dir(&config.browser_id)?;
    if config.browser_id == "chrome" && !profile.exists() {
        let old = vault::dir()?.join("browser-profile");
        if old.exists() {
            let root = vault::dir()?
                .canonicalize()
                .map_err(|_| "无法确认浏览器数据目录")?;
            let source = old.canonicalize().map_err(|_| "无法确认旧环境目录")?;
            if source.parent() != Some(root.as_path()) || source.file_name() != old.file_name() {
                return Err("旧环境目录异常，已保留数据".into());
            }
            std::fs::rename(&source, &profile).map_err(|_| "旧浏览器环境仍被占用，请关闭后重试")?;
        }
    }
    std::fs::create_dir_all(&profile).map_err(|_| "无法创建独立浏览器配置档")?;
    // 部分 Chrome 版本会忽略旧版强制启用 WebRTC 的命令行开关。
    // 因此在 CodeSeam 专用配置档中保存 Chromium 的实际偏好设置。
    let default = profile.join("Default");
    std::fs::create_dir_all(&default).map_err(|_| "无法创建受管浏览器首选项目录")?;
    let pref_path = default.join("Preferences");
    let mut prefs: Value = if pref_path.exists() {
        serde_json::from_slice(&std::fs::read(&pref_path).map_err(|_| "无法读取浏览器首选项")?)
            .map_err(|_| "浏览器首选项损坏，请检查独立配置档")?
    } else {
        json!({})
    };
    prefs["webrtc"]["ip_handling_policy"] = json!(if config.block_webrtc {
        "disable_non_proxied_udp"
    } else {
        "default"
    });
    prefs["webrtc"]["ip_handling_url"] = json!([]);
    let tmp = default.join("CodeSeam-Preferences.tmp");
    std::fs::write(
        &tmp,
        serde_json::to_vec(&prefs).map_err(|_| "首选项序列化失败")?,
    )
    .map_err(|_| "无法写入浏览器首选项")?;
    std::fs::rename(&tmp, &pref_path).map_err(|_| "无法更新浏览器首选项，请关闭旧受管会话")?;
    // 新版 Chrome 要求使用由 Chromium 选择的端口和非默认配置档。
    let active = profile.join("DevToolsActivePort");
    if active.exists() {
        std::fs::remove_file(&active).map_err(|_| "旧浏览器会话仍在使用配置档，请关闭后重试")?;
    }
    let mut command = Command::new(executable_for(&config.browser_id)?);
    command
        .args([
            "--remote-debugging-port=0",
            "--remote-debugging-address=127.0.0.1",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-networking",
            "--disable-quic",
            "--dns-prefetch-disable",
            "--disable-features=DnsOverHttps",
            "--proxy-bypass-list=<-loopback>",
        ])
        .arg(format!(
            "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE {}",
            reqwest::Url::parse(&config.proxy)
                .map_err(|_| "代理地址无效")?
                .host_str()
                .ok_or("代理主机无效")?
        ))
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg(format!("--proxy-server={}", config.proxy))
        .arg(format!("--lang={}", config.language))
        .arg(format!("--accept-lang={}", config.language))
        .arg("about:blank")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let child = command.spawn().map_err(|_| "无法启动受管浏览器")?;
    let (tx, mut rx) = mpsc::channel::<Request>(32);
    let errors = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let mut session = Session {
        child,
        cdp: Cdp { tx },
        config: config.clone(),
        errors: errors.clone(),
        _proxy: None,
        task: tokio::spawn(async {}),
        #[cfg(windows)]
        _job: None,
    };
    #[cfg(windows)]
    {
        session._job = Some(Job::new(&session.child)?);
    }
    let mut endpoint = None;
    for _ in 0..100 {
        if let Ok(raw) = std::fs::read_to_string(&active) {
            let mut lines = raw.lines();
            if let (Some(port), Some(path)) = (lines.next(), lines.next()) {
                if let Ok(port) = port.parse::<u16>() {
                    endpoint = Some(format!("ws://127.0.0.1:{port}{path}"));
                    break;
                }
            }
        }
        if session
            .child
            .try_wait()
            .map_err(|_| "无法读取浏览器状态")?
            .is_some()
        {
            return Err("浏览器提前退出，请关闭旧受管会话后重试".into());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let (ws, _) = connect_async(endpoint.ok_or("未能连接浏览器调试接口")?)
        .await
        .map_err(|_| "浏览器调试连接失败")?;
    let (mut sink, mut stream) = ws.split();
    session.task = tokio::spawn(async move {
        let mut next = 0u64;
        let mut pending = HashMap::new();
        loop {
            tokio::select! {
                req = rx.recv() => {
                    let Some(r) = req else { break };
                    next += 1;
                    let mut v = json!({"id":next,"method":r.method,"params":r.params});
                    if let Some(s) = r.session { v["sessionId"] = json!(s); }
                    pending.insert(next, r.result);
                    if sink.send(Message::Text(v.to_string().into())).await.is_err() { break; }
                }
                msg = stream.next() => {
                    let raw = match msg { Some(Ok(Message::Text(raw))) => raw, Some(Ok(Message::Ping(v))) => { if sink.send(Message::Pong(v)).await.is_err() { break; } continue; }, Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break, _ => continue };
                    let Ok(v) = serde_json::from_str::<Value>(&raw) else { continue };
                    #[cfg(test)]
                    if v["method"]=="Network.loadingFailed" {println!("browser-network-error: {}",v["params"]);}
                    if v["method"] == "Target.attachedToTarget" {
                        let s = v["params"]["sessionId"].as_str().unwrap_or("");
                        let kind = v["params"]["targetInfo"]["type"].as_str().unwrap_or("");
                        let mut commands = vec![];
                        if kind == "page" || kind == "iframe" {
                            commands.extend([
                                ("Page.enable", json!({})),
                                ("Emulation.setTimezoneOverride", json!({"timezoneId":config.timezone})),
                                ("Emulation.setHardwareConcurrencyOverride", json!({"hardwareConcurrency":config.cores})),
                                ("Emulation.setDeviceMetricsOverride", json!({"width":config.width,"height":config.height,"screenWidth":config.width,"screenHeight":config.height,"deviceScaleFactor":1,"mobile":false})),
                                ("Target.setAutoAttach", json!({"autoAttach":true,"waitForDebuggerOnStart":true,"flatten":true})),
                            ]);
                        }
                        commands.push(("Runtime.runIfWaitingForDebugger", json!({})));
                        for (method, params) in commands {
                            next += 1;
                            if sink.send(Message::Text(json!({"id":next,"method":method,"params":params,"sessionId":s}).to_string().into())).await.is_err() { return; }
                        }
                    } else if let Some(id) = v["id"].as_u64() {
                        let result = if v.get("error").is_some() { Err(format!("浏览器命令失败：{}", v["error"]["message"].as_str().unwrap_or("CDP error"))) } else { Ok(v["result"].clone()) };
                        if let Some(tx) = pending.remove(&id) { let _ = tx.send(result); }
                        else if let Err(e) = result { if let Ok(mut list) = errors.lock() { if list.len() < 20 { list.push(e); } } }
                    }
                }
            }
        }
    });
    session
        .cdp
        .call(
            "Target.setAutoAttach",
            json!({"autoAttach":true,"waitForDebuggerOnStart":true,"flatten":true}),
            None,
        )
        .await?;
    // 确认初始空白页面已收到模拟配置。
    let pages = session
        .cdp
        .call("Target.getTargets", json!({}), None)
        .await?;
    if let Some(pages) = pages["targetInfos"].as_array() {
        for page in pages.iter().filter(|p| p["type"] == "page") {
            let a = session
                .cdp
                .call(
                    "Target.attachToTarget",
                    json!({"targetId":page["targetId"],"flatten":true}),
                    None,
                )
                .await?;
            session
                .cdp
                .call("Page.reload", json!({}), a["sessionId"].as_str())
                .await?;
        }
    }
    Ok(session)
}
#[tauri::command]
pub async fn cs_browser_status(
    state: tauri::State<'_, BrowserState>,
    browser_id: Option<String>,
) -> Result<Value, String> {
    let id = browser_id.unwrap_or_else(default_browser);
    if !browser_id_valid(&id) {
        return Err("不支持的浏览器".into());
    }
    let mut guard = state.session.lock().await;
    if let Some(s) = guard.as_mut() {
        if s.task.is_finished()
            || s.child
                .try_wait()
                .map_err(|_| "无法读取浏览器状态")?
                .is_some()
        {
            guard.take();
        }
    }
    let running = guard.as_ref().is_some_and(|s| s.config.browser_id == id);
    let config = if running {
        guard.as_ref().unwrap().config.clone()
    } else {
        saved_for(&id)?
    };
    let created = vault::read(&config_file(&id))?.is_some()
        || (id == "chrome" && vault::read("browser.dpapi")?.is_some());
    Ok(
        json!({"running":running,"runningBrowserId":guard.as_ref().map(|s|&s.config.browser_id),"created":created,"config":config,"report":read_json(&report_file(&id))?,"browsers":installed()}),
    )
}
#[tauri::command]
pub async fn cs_browser_start(
    state: tauri::State<'_, BrowserState>,
    mut config: Config,
) -> Result<Value, String> {
    if !browser_id_valid(&config.browser_id) {
        return Err("不支持的浏览器".into());
    }
    let proxy = super::sg::browser_proxy().await?;
    config.proxy = proxy
        .as_ref()
        .map(|p| p.address.clone())
        .or_else(system_proxy)
        .ok_or("请先在代理与网络中配置代理，或启用当前系统代理")?;
    config.expected_ip = proxy
        .as_ref()
        .map(|p| p.expected.clone())
        .unwrap_or_default();
    config.validate()?;
    let mut guard = state.session.lock().await;
    close_session(&mut guard).await;
    let mut session = launch(config.clone()).await?;
    session._proxy = proxy;
    vault::save(
        &config_file(&config.browser_id),
        &serde_json::to_vec(&config).map_err(|_| "配置保存失败")?,
    )?;
    *guard = Some(session);
    Ok(
        json!({"running":true,"created":true,"config":config,"report":read_json(&report_file(&config.browser_id))?,"browsers":installed()}),
    )
}
#[tauri::command]
pub async fn cs_browser_stop(state: tauri::State<'_, BrowserState>) -> Result<(), String> {
    state.stop().await;
    Ok(())
}
#[tauri::command]
pub async fn cs_browser_destroy(
    state: tauri::State<'_, BrowserState>,
    browser_id: String,
    confirmed: bool,
) -> Result<(), String> {
    if !confirmed || !browser_id_valid(&browser_id) {
        return Err("销毁浏览器环境需要确认".into());
    }
    let mut guard = state.session.lock().await;
    if guard
        .as_ref()
        .is_some_and(|s| s.config.browser_id == browser_id)
    {
        close_session(&mut guard).await;
    }
    let dir = profile_dir(&browser_id)?;
    if dir.exists() {
        let root = vault::dir()?
            .canonicalize()
            .map_err(|_| "无法确认数据目录")?;
        let target = dir.canonicalize().map_err(|_| "无法确认环境目录")?;
        if target.parent() != Some(root.as_path()) || target.file_name() != dir.file_name() {
            return Err("环境目录指向异常，已停止销毁".into());
        }
        std::fs::remove_dir_all(&target).map_err(|_| "环境仍被占用，请关闭相关窗口后重试")?;
    }
    for file in [
        config_file(&browser_id),
        report_file(&browser_id),
        baseline_file(&browser_id),
    ] {
        vault::remove(&file)?;
    }
    if browser_id == "chrome" {
        vault::remove("browser.dpapi")?;
    }
    Ok(())
}
fn check(id: &str, label: &str, status: &str, detail: String, evidence: Value) -> Check {
    Check {
        id: id.into(),
        label: label.into(),
        status: status.into(),
        detail,
        evidence: Some(evidence.to_string()),
        protected: false,
        remediation: None,
    }
}
const PROBE: &str = include_str!("browser_probe.js");
async fn diagnose(s: &Probe) -> Result<Value, String> {
    diagnose_selected(s, None).await
}
async fn diagnose_selected(s: &Probe, only: Option<&str>) -> Result<Value, String> {
    let expression = format!(
        "globalThis.__csProbe = {}; {}",
        serde_json::to_string(&only).unwrap_or_default(),
        PROBE
    );
    let observed: Value = if s.config.browser_id == "firefox" {
        firefox_observe(s, &expression).await?
    } else {
        let target = s
            .cdp
            .call(
                "Target.createTarget",
                json!({"url":"about:blank","background":true}),
                None,
            )
            .await?;
        let id = target["targetId"].as_str().ok_or("无法创建检测页面")?;
        let result: Result<Value, String> = async {
            let a = s
                .cdp
                .call(
                    "Target.attachToTarget",
                    json!({"targetId":id,"flatten":true}),
                    None,
                )
                .await?;
            let sid = a["sessionId"].as_str().ok_or("无法连接检测页面")?;
            s.cdp.call("Network.enable", json!({}), Some(sid)).await?;
            s.cdp
                .call(
                    "Page.navigate",
                    json!({"url":"data:text/html,<title>CodeSeam diagnostic</title>"}),
                    Some(sid),
                )
                .await?;
            // 等待新文档加载，避免错误测量上一个 about:blank 执行上下文。
            let mut ready = false;
            for _ in 0..50 {
                let r = s
                    .cdp
                    .call(
                        "Runtime.evaluate",
                        json!({"expression":"document.title","returnByValue":true}),
                        Some(sid),
                    )
                    .await;
                if r.as_ref()
                    .ok()
                    .is_some_and(|v| v["result"]["value"] == "CodeSeam diagnostic")
                {
                    ready = true;
                    break;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            if !ready {
                return Err("检测页面加载超时".into());
            }
            let raw = s
                .cdp
                .call(
                    "Runtime.evaluate",
                    json!({"expression":expression,"awaitPromise":true,"returnByValue":true}),
                    Some(sid),
                )
                .await?;
            if raw.get("exceptionDetails").is_some() {
                return Err("浏览器检测脚本执行失败".into());
            }
            Ok(raw["result"]["value"].clone())
        }
        .await;
        let _ = s
            .cdp
            .call("Target.closeTarget", json!({"targetId":id}), None)
            .await;
        result?
    };
    let proxy = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(&s.config.proxy).map_err(|_| "代理地址无效")?)
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| "代理探针初始化失败")?;
    let proxy_ip = if only.is_none_or(|id| {
        matches!(
            id,
            "browser_egress" | "browser_dns" | "browser_webrtc" | "browser_region"
        )
    }) {
        async {
            proxy
                .get("https://api4.ipify.org?format=json")
                .send()
                .await
                .ok()?
                .error_for_status()
                .ok()?
                .json::<Value>()
                .await
                .ok()?["ip"]
                .as_str()
                .map(str::to_string)
        }
        .await
    } else {
        None
    };
    let browser_ip = observed["ipv4"]["ip"]
        .as_str()
        .filter(|ip| ip.parse::<std::net::Ipv4Addr>().is_ok());
    let matches = browser_ip
        .zip(proxy_ip.as_deref())
        .map(|(a, b)| a == b && (s.config.expected_ip.is_empty() || a == s.config.expected_ip));
    let errors = s.errors.lock().map(|v| v.clone()).unwrap_or_default();
    let f = &observed["fingerprint"];
    let baseline = read_json(&baseline_file(&s.config.browser_id))?;
    let configured_fp = f["language"] == s.config.language
        && f["timezone"] == s.config.timezone
        && f["width"] == s.config.width
        && f["height"] == s.config.height
        && f["cores"] == s.config.cores
        && errors.is_empty();
    if only.is_none_or(|id| id == "browser_fingerprint") && configured_fp && baseline.is_none() {
        write_json(&baseline_file(&s.config.browser_id), f)?;
    }
    let fp_ok = configured_fp && baseline.as_ref().is_none_or(|b| b == f);
    let public: Vec<String> = observed["webrtc"]["candidates"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter_map(|c| {
            let parts: Vec<_> = c.split_whitespace().collect();
            let ip = parts.get(4)?.parse::<std::net::IpAddr>().ok()?;
            let public = match ip {
                std::net::IpAddr::V4(v) => {
                    !v.is_private() && !v.is_loopback() && !v.is_link_local() && !v.is_unspecified()
                }
                std::net::IpAddr::V6(v) => {
                    !v.is_loopback()
                        && !v.is_unspecified()
                        && (v.segments()[0] & 0xfe00) != 0xfc00
                        && (v.segments()[0] & 0xffc0) != 0xfe80
                }
            };
            public.then(|| ip.to_string())
        })
        .collect();
    let rtc_mismatch = proxy_ip
        .as_ref()
        .is_some_and(|ip| public.iter().any(|c| c != ip));
    let udp_after_block = s.config.block_webrtc
        && observed["webrtc"]["candidates"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .any(|c| {
                c.split_whitespace()
                    .nth(2)
                    .is_some_and(|p| p.eq_ignore_ascii_case("udp"))
            });
    let dns_guarded = s.config.browser_id != "firefox"
        && reqwest::Url::parse(&s.config.proxy).ok().is_some_and(|u| {
            u.host_str().is_some_and(|h| {
                h.trim_matches(['[', ']'])
                    .parse::<std::net::IpAddr>()
                    .is_ok()
            })
        });
    let region = region_check(&observed["geolocation"], f, browser_ip, matches);
    let checks = vec![
        check(
            "browser_egress",
            "浏览器 / 代理出口",
            match matches {
                Some(true) => "pass",
                Some(false) => "fail",
                None => "unknown",
            },
            match matches {
                Some(true) => "浏览器与代理单次 HTTPS 出口一致",
                Some(false) => "浏览器、代理或预期出口不一致",
                None => "出口探针未完成，无法判断一致性",
            }
            .into(),
            json!({"browser":browser_ip,"proxy":proxy_ip,"expected":s.config.expected_ip,"raw":observed["ipv4"],"region":region}),
        ),
        check(
            "browser_ipv6",
            "浏览器 IPv6",
            if observed["ipv6"]["ip"].is_string() {
                "fail"
            } else {
                "unknown"
            },
            if observed["ipv6"]["ip"].is_string() {
                "IPv6 仍可访问，请关闭系统 IPv6"
            } else {
                "请在系统环境中验证 IPv6 已关闭"
            }
            .into(),
            observed["ipv6"].clone(),
        ),
        check(
            "browser_dns",
            "浏览器 DNS",
            if dns_guarded && matches == Some(true) {
                "pass"
            } else {
                "unknown"
            },
            if dns_guarded && matches == Some(true) {
                "本地解析已阻断，域名请求经代理成功"
            } else {
                "请核对代理连接和 DNS 保护配置"
            }
            .into(),
            json!({"proxy":s.config.proxy,"localResolutionBlocked":dns_guarded,"namedProbe":"api4.ipify.org","egressMatches":matches,"scope":"此受管浏览器的域名请求；不代表 Windows 全局 DNS 路径"}),
        ),
        check(
            "browser_webrtc",
            "WebRTC / STUN",
            if rtc_mismatch || udp_after_block {
                "fail"
            } else if s.config.block_webrtc
                && observed["webrtc"]["supported"] == true
                && observed["webrtc"]["error"].is_null()
            {
                "pass"
            } else {
                "unknown"
            },
            if udp_after_block {
                "已配置阻止直连 UDP，但仍观测到 UDP 候选，请核查浏览器策略"
            } else if rtc_mismatch {
                "发现与 HTTPS 代理出口不同的公网候选地址"
            } else if public.is_empty() {
                "直连 UDP 已限制，本次未发现直连候选"
            } else {
                "已采集与代理一致的公网候选；仅代表本次探针"
            }
            .into(),
            json!({"observation":observed["webrtc"],"publicAddresses":public,"blockNonProxiedUdp":s.config.block_webrtc}),
        ),
        check(
            "browser_fingerprint",
            "指纹一致性",
            if fp_ok { "pass" } else { "fail" },
            if fp_ok {
                "与保存的指纹基准一致"
            } else {
                "指纹与保存的基准不一致，请展开查看差异"
            }
            .into(),
            json!({"observed":f,"baseline":baseline,"errors":errors,"scope":"检查配置一致性；地区需用户按预期出口设置，未修改 Canvas / WebGL / 字体"}),
        ),
        region_check(&observed["geolocation"], f, browser_ip, matches),
    ];
    let selected: Vec<_> = checks
        .into_iter()
        .filter(|c| only.is_none_or(|id| c.id == id))
        .collect();
    let mut report = read_json(&report_file(&s.config.browser_id))?
        .unwrap_or_else(|| json!({"checks":[],"observed":{}}));
    let mut merged: Vec<Check> =
        serde_json::from_value(report["checks"].clone()).unwrap_or_default();
    for c in &selected {
        merged.retain(|old| old.id != c.id);
        merged.push(c.clone());
    }
    if let Some(o) = observed.as_object() {
        for (k, v) in o {
            if k == "geolocation"
                && !only.is_none_or(|id| matches!(id, "browser_egress" | "browser_region"))
            {
                continue;
            }
            if !v.as_object().is_some_and(|o| o.is_empty()) {
                report["observed"][k] = v.clone();
            }
        }
    }
    report["generatedAt"] = json!(super::now());
    report["checks"] = json!(merged);
    report["config"] = json!(s.config);
    write_json(&report_file(&s.config.browser_id), &report)?;
    Ok(json!({"generatedAt":super::now(),"checks":selected,"config":s.config,"observed":observed}))
}
fn region_check(
    geo: &Value,
    fingerprint: &Value,
    browser_ip: Option<&str>,
    egress_matches: Option<bool>,
) -> Check {
    let valid = geo["success"] == true
        && geo["ip"].as_str() == browser_ip
        && browser_ip.is_some()
        && geo["timezone"].is_string()
        && geo["countryCode"].is_string()
        && egress_matches == Some(true);
    let language = fingerprint["language"].as_str().unwrap_or("");
    let country = language
        .split('-')
        .find(|p| p.len() == 2 && p.bytes().all(|b| b.is_ascii_uppercase()));
    let mismatch = geo["timezone"] != fingerprint["timezone"]
        || country.is_some_and(|c| Some(c) != geo["countryCode"].as_str());
    let detail = if valid {
        format!(
            "IP 地理库推测 {} / {}；浏览器语言 {}、时区 {}{}",
            geo["countryCode"].as_str().unwrap_or(""),
            geo["timezone"].as_str().unwrap_or(""),
            language,
            fingerprint["timezone"].as_str().unwrap_or(""),
            if mismatch {
                "，存在差异，请核对"
            } else {
                "，本次对照一致"
            }
        )
    } else {
        "出口或 IP 地区查询未取得完整证据，无法判断地区一致性".into()
    };
    check(
        "browser_region",
        "出口地区与浏览器环境",
        if !valid {
            "unknown"
        } else if mismatch {
            "warning"
        } else {
            "pass"
        },
        detail,
        json!({"lookup":geo,"language":language,"timezone":fingerprint["timezone"],"limitation":"IP 地理库可能不准确；多语言或多时区地区需人工核对，不作为实际位置证明"}),
    )
}
#[tauri::command]
pub async fn cs_browser_diagnose(state: tauri::State<'_, BrowserState>) -> Result<Value, String> {
    let snapshot = state
        .session
        .lock()
        .await
        .as_ref()
        .map(Session::snapshot)
        .ok_or("请先启动受管浏览器")?;
    diagnose(&snapshot).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_configuration() {
        let mut c = Config::default();
        assert!(c.validate().is_ok());
        for raw in [
            "direct://",
            "http://u:p@localhost:7890",
            "http://localhost:18899/claude",
            "http://localhost:7890?x=1",
        ] {
            c.proxy = raw.into();
            assert!(c.validate().is_err());
        }
        c = Config::default();
        c.language = "en\r\nX: bad".into();
        assert!(c.validate().is_err());
    }
    #[test]
    fn geography_requires_matching_ip_and_flags_fingerprint_difference() {
        let geo =
            json!({"success":true,"ip":"192.0.2.1","countryCode":"SG","timezone":"Asia/Singapore"});
        let f = json!({"language":"en-SG","timezone":"Asia/Singapore"});
        assert_eq!(
            region_check(&geo, &f, Some("192.0.2.1"), Some(true)).status,
            "pass"
        );
        assert_eq!(
            region_check(
                &geo,
                &json!({"language":"en-US","timezone":"America/Los_Angeles"}),
                Some("192.0.2.1"),
                Some(true)
            )
            .status,
            "warning"
        );
        assert_eq!(
            region_check(&geo, &f, Some("192.0.2.2"), Some(true)).status,
            "unknown"
        );
        assert_eq!(
            region_check(&geo, &f, Some("192.0.2.1"), None).status,
            "unknown"
        );
    }
    #[tokio::test]
    #[ignore = "opens isolated real installed browser; explicit test data directory required"]
    async fn retained_browser_identity() {
        assert!(std::env::var_os("CODESEAM_TEST_DATA_DIR").is_some());
        let mut config = Config::default();
        config.browser_id =
            std::env::var("CODESEAM_TEST_BROWSER").unwrap_or_else(|_| "chrome".into());
        config.proxy = std::env::var("CODESEAM_BROWSER_TEST_PROXY")
            .unwrap_or_else(|_| "http://127.0.0.1:4651".into());
        config.block_webrtc = true;
        let first = launch(config.clone()).await.unwrap();
        if config.browser_id != "firefox" {
            first.cdp.call("Storage.setCookies",json!({"cookies":[{"url":"https://qa.example.invalid","name":"codeseam_test","value":"retained","expires":super::super::now()+3600}]}),None).await.unwrap();
        }
        let initial = diagnose_selected(&first.snapshot(), Some("browser_fingerprint"))
            .await
            .unwrap();
        assert_eq!(initial["checks"][0]["status"], "pass", "{initial}");
        let baseline = read_json(&baseline_file(&config.browser_id))
            .unwrap()
            .unwrap();
        let mut session = Some(first);
        close_session(&mut session).await;
        assert!(session.is_none());
        let next = launch(config.clone()).await.unwrap();
        if config.browser_id != "firefox" {
            let cookies = next
                .cdp
                .call("Storage.getCookies", json!({}), None)
                .await
                .unwrap();
            assert!(
                cookies["cookies"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|c| c["name"] == "codeseam_test" && c["value"] == "retained"),
                "saved session cookie must survive close and reopen"
            );
        }
        let reopened = diagnose_selected(&next.snapshot(), Some("browser_fingerprint"))
            .await
            .unwrap();
        assert_eq!(reopened["checks"][0]["status"], "pass", "{reopened}");
        assert_eq!(
            read_json(&baseline_file(&config.browser_id))
                .unwrap()
                .unwrap(),
            baseline
        );
        assert!(read_json(&report_file(&config.browser_id))
            .unwrap()
            .is_some());
        let mut session = Some(next);
        close_session(&mut session).await;
        config.width += 100;
        let changed = launch(config.clone()).await.unwrap();
        let drift = diagnose_selected(&changed.snapshot(), Some("browser_fingerprint"))
            .await
            .unwrap();
        assert_eq!(drift["checks"][0]["status"], "fail");
        assert_eq!(
            read_json(&baseline_file(&config.browser_id))
                .unwrap()
                .unwrap(),
            baseline,
            "drift must not replace baseline"
        );
        let mut session = Some(changed);
        close_session(&mut session).await;
        println!(
            "retained-browser-identity: passed for {}",
            config.browser_id
        );
    }
    #[tokio::test]
    #[ignore = "uses an explicitly configured real proxy and isolated browser profile"]
    async fn guarded_dns_path() {
        assert!(std::env::var_os("CODESEAM_TEST_DATA_DIR").is_some());
        let mut c = Config::default();
        c.proxy = std::env::var("CODESEAM_BROWSER_TEST_PROXY")
            .unwrap_or_else(|_| "http://127.0.0.1:4651".into());
        let session = launch(c).await.unwrap();
        let result = diagnose_selected(&session.snapshot(), Some("browser_dns"))
            .await
            .unwrap();
        let mut guard = Some(session);
        close_session(&mut guard).await;
        assert_eq!(result["checks"][0]["status"], "pass", "{result}");
        let mut dead = Config::default();
        dead.proxy = "http://127.0.0.1:9".into();
        let session = launch(dead).await.unwrap();
        let failed = diagnose_selected(&session.snapshot(), Some("browser_dns"))
            .await
            .unwrap();
        let mut guard = Some(session);
        close_session(&mut guard).await;
        assert_ne!(failed["checks"][0]["status"], "pass");
        assert!(
            failed["observed"]["ipv4"]["ip"].is_null(),
            "failed proxy must not fall back to a direct connection"
        );
        println!("guarded-browser-dns: passed, including no direct fallback");
    }
    #[tokio::test]
    #[ignore = "starts a real independent Chrome/Edge session; explicit opt-in"]
    async fn real_browser() {
        let mut c = Config::default();
        c.proxy =
            std::env::var("CODESEAM_BROWSER_TEST_PROXY").unwrap_or("http://127.0.0.1:7890".into());
        c.block_webrtc = std::env::var("CODESEAM_BROWSER_TEST_BLOCK").is_ok();
        if std::env::var("CODESEAM_BROWSER_TEST_MODIFIED").is_ok() {
            c.language = "ja-JP".into();
            c.timezone = "Asia/Tokyo".into();
            c.width = 1600;
            c.height = 900;
            c.cores = 4;
        }
        c.expected_ip = std::env::var("CODESEAM_BROWSER_TEST_EXPECTED").unwrap_or_default();
        let s = launch(c).await.unwrap();
        let report = diagnose(&s.snapshot()).await.unwrap();
        println!("{}", report);
        assert_eq!(report["checks"][4]["status"], "pass");
        if std::env::var("CODESEAM_BROWSER_TEST_BLOCK").is_ok() {
            assert!(report["observed"]["webrtc"]["candidates"]
                .as_array()
                .unwrap()
                .is_empty());
        }
        if std::env::var("CODESEAM_BROWSER_TEST_DEAD").is_ok() {
            assert!(report["observed"]["ipv4"].get("ip").is_none());
            assert_ne!(report["checks"][0]["status"], "pass");
        }
        if std::env::var("CODESEAM_BROWSER_TEST_EXPECTED").is_ok()
            && report["observed"]["ipv4"]["ip"].is_string()
        {
            assert_eq!(report["checks"][0]["status"], "fail");
        }
        if let Ok(p) = std::env::var("CODESEAM_BROWSER_TEST_REPORT") {
            std::fs::write(p, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
        }
        let active = std::fs::read_to_string(
            vault::dir()
                .unwrap()
                .join("browser-profile-chrome/DevToolsActivePort"),
        )
        .unwrap();
        let port = active.lines().next().unwrap().parse::<u16>().unwrap();
        drop(s);
        assert!(
            tokio::net::TcpStream::connect(("127.0.0.1", port))
                .await
                .is_err(),
            "browser debugging port remains open after close"
        );
    }
}

//! Windows 系统网络变更由固定操作的 UAC 辅助程序预览、备份并执行。
//! 只有未提权的父进程会写入 DPAPI 备份。
use super::{network::Check, vault};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;

const SCRIPT: &str = include_str!("system_network.ps1");
const PLAN: &str = "system-network-plan.dpapi";
#[derive(Default)]
pub struct SystemNetwork {
    lock: Mutex<()>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    action: String,
    adapter_ids: Vec<String>,
    preset: Option<String>,
    doh: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Plan {
    id: String,
    created_at: u64,
    change: Change,
    before: Value,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Backup {
    plan: Plan,
    phase: String,
    applied_at: u64,
}
#[derive(Serialize, Deserialize)]
struct HelperRequest {
    op: String,
    plan: Plan,
}
fn token() -> String {
    format!(
        "{:032x}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    )
}
fn valid_token(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| b.is_ascii_hexdigit())
}
fn valid_guid(s: &str) -> bool {
    s.len() == 36
        && s.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}
fn profile(name: Option<&str>) -> Result<Value, String> {
    match name {
        Some("proxy") => Ok(
            json!({"id":"proxy","name":"本机代理 DNS","servers":["127.0.0.1","::1"],"template":""}),
        ),
        Some("quad9") => Ok(
            json!({"id":"quad9","name":"Quad9 威胁过滤","servers":["9.9.9.9","149.112.112.112","2620:fe::fe","2620:fe::9"],"template":"https://dns.quad9.net/dns-query"}),
        ),
        Some("cloudflare") => Ok(
            json!({"id":"cloudflare","name":"Cloudflare 恶意软件过滤","servers":["1.1.1.2","1.0.0.2","2606:4700:4700::1112","2606:4700:4700::1002"],"template":"https://security.cloudflare-dns.com/dns-query"}),
        ),
        _ => Err("请选择受支持的可信 DNS 方案".into()),
    }
}
impl Change {
    fn validate(&self) -> Result<(), String> {
        if !matches!(self.action.as_str(), "disable_ipv6" | "set_dns") {
            return Err("不支持的系统网络操作".into());
        }
        if self.adapter_ids.is_empty()
            || self.adapter_ids.len() > 128
            || self.adapter_ids.iter().any(|s| !valid_guid(s))
        {
            return Err("网卡身份无效，请重新检测".into());
        }
        let mut ids = self.adapter_ids.clone();
        ids.sort();
        ids.dedup();
        if ids.len() != self.adapter_ids.len() {
            return Err("网卡不可重复".into());
        }
        if self.action == "set_dns" {
            profile(self.preset.as_deref())?;
        } else if self.doh || self.preset.is_some() {
            return Err("IPv6 操作不可附带 DNS 参数".into());
        }
        Ok(())
    }
}
fn backup_file(action: &str) -> Result<&'static str, String> {
    match action {
        "disable_ipv6" => Ok("system-ipv6-backup.dpapi"),
        "set_dns" => Ok("system-dns-backup.dpapi"),
        _ => Err("不支持的备份类型".into()),
    }
}
fn load_backup(action: &str) -> Result<Option<Backup>, String> {
    vault::read(backup_file(action)?)?
        .map(|b| {
            serde_json::from_slice(&b).map_err(|_| "系统网络备份损坏，请保留文件并停止覆盖".into())
        })
        .transpose()
}
fn powershell(request: Value) -> Result<Value, String> {
    powershell_source(request, SCRIPT)
}
fn powershell_source(request: Value, source: &str) -> Result<Value, String> {
    let payload = STANDARD.encode(serde_json::to_vec(&request).map_err(|_| "请求序列化失败")?);
    let script=format!("$Request = ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{payload}')) | ConvertFrom-Json);\n{source}");
    #[cfg(windows)]
    let system_dir = unsafe {
        let mut path = vec![0u16; 32768];
        let len = windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW(
            path.as_mut_ptr(),
            path.len() as u32,
        );
        if len == 0 || len as usize >= path.len() {
            return Err("无法确认 Windows 系统目录".into());
        }
        std::path::PathBuf::from(String::from_utf16_lossy(&path[..len as usize]))
    };
    #[cfg(not(windows))]
    let system_dir = std::path::PathBuf::from("unsupported");
    let executable = system_dir.join("WindowsPowerShell/v1.0/powershell.exe");
    let mut child=super::cli::hidden(executable.to_str().ok_or("Windows 路径无效")?)
        .env("PSModulePath",system_dir.join("WindowsPowerShell/v1.0/Modules"))
        .args(["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-Command","[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);$s=[Console]::In.ReadToEnd(); & ([ScriptBlock]::Create($s))"])
        .stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().map_err(|_|"无法启动 Windows 网络查询")?;
    child
        .stdin
        .take()
        .ok_or("无法写入网络操作请求")?
        .write_all(script.as_bytes())
        .map_err(|_| "网络操作请求写入失败")?;
    let output = child
        .wait_with_output()
        .map_err(|_| "无法等待 Windows 网络查询")?;
    let v: Value = serde_json::from_slice(&output.stdout).map_err(|_| {
        format!(
            "Windows 网络操作未返回有效结果（退出码 {:?}）",
            output.status.code()
        )
    })?;
    Ok(v)
}
fn read_config(probe: bool) -> Result<Value, String> {
    let v = powershell(json!({"op":"read","probe":probe}))?;
    if v["ok"] != true {
        return Err(v["error"].as_str().unwrap_or("Windows 网络读取失败").into());
    }
    Ok(v["data"].clone())
}
fn validate_plan(plan: &Plan) -> Result<(), String> {
    plan.change.validate()?;
    if !valid_token(&plan.id) {
        return Err("计划标识无效".into());
    }
    let adapters = plan.before["adapters"]
        .as_array()
        .ok_or("计划缺少网卡快照")?;
    for id in &plan.change.adapter_ids {
        let a = adapters
            .iter()
            .find(|a| a["id"].as_str() == Some(id))
            .ok_or("网卡不在计划快照内")?;
        if plan.change.action == "set_dns" && a["dnsAvailable"] != true {
            return Err("所选网卡不支持 DNS 配置".into());
        }
        if plan.change.action == "disable_ipv6" && !a["ipv6Enabled"].is_boolean() {
            return Err("所选网卡没有 IPv6 绑定".into());
        }
    }
    if plan.change.action == "disable_ipv6" {
        let expected: std::collections::BTreeSet<_> = adapters
            .iter()
            .filter(|a| a["ipv6Enabled"].is_boolean() && a["status"] != "Not Present")
            .filter_map(|a| a["id"].as_str())
            .collect();
        let selected: std::collections::BTreeSet<_> =
            plan.change.adapter_ids.iter().map(String::as_str).collect();
        if selected != expected {
            return Err("关闭系统 IPv6 需要包含全部可配置网卡，请重新检测并预览".into());
        }
    }
    if plan.change.doh && plan.before["dohSupported"] != true {
        return Err("当前 Windows 不支持原生 DoH，无法应用加密 DNS".into());
    }
    Ok(())
}
fn payload(op: &str, plan: &Plan) -> Result<Value, String> {
    validate_plan(plan)?;
    Ok(
        json!({"op":op,"action":plan.change.action,"adapterIds":plan.change.adapter_ids,"doh":plan.change.doh,"profile":if plan.change.action=="set_dns"{profile(plan.change.preset.as_deref())?}else{Value::Null},"before":plan.before}),
    )
}
fn operations_dir() -> Result<std::path::PathBuf, String> {
    let dir = vault::dir()?.join("network-ops");
    fs::create_dir_all(&dir).map_err(|_| "无法建立系统操作目录")?;
    // 以提权方式运行时，不跟随被替换的操作目录。
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if fs::symlink_metadata(&dir)
            .map_err(|_| "无法读取操作目录")?
            .file_attributes()
            & 0x400
            != 0
        {
            return Err("操作目录不可为重解析点".into());
        }
    }
    Ok(dir)
}
/// 仅通过固定格式的十六进制令牌调用，并在初始化 Tauri 和单实例插件前执行。
pub fn helper(id: &str) -> i32 {
    let result = (|| -> Result<(), String> {
        if !valid_token(id) {
            return Err("无效操作标识".into());
        }
        let dir = operations_dir()?;
        let bytes =
            fs::read(dir.join(format!("{id}.request.json"))).map_err(|_| "无法读取提权请求")?;
        if bytes.len() > 1024 * 1024 {
            return Err("请求过大".into());
        }
        let req: HelperRequest = serde_json::from_slice(&bytes).map_err(|_| "提权请求格式无效")?;
        if !matches!(req.op.as_str(), "apply" | "restore") {
            return Err("无效提权操作".into());
        }
        let v = powershell(payload(&req.op, &req.plan)?)?;
        // CREATE_NEW 会拒绝已存在的文件或链接。辅助程序不会更新用户控制的脚本、二进制文件、
        // 备份路径或任意输出路径。
        let mut out = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(dir.join(format!("{id}.result.json")))
            .map_err(|_| "无法保存提权结果")?;
        out.write_all(&serde_json::to_vec(&v).map_err(|_| "结果序列化失败")?)
            .map_err(|_| "结果写入失败")?;
        Ok(())
    })();
    if result.is_ok() {
        0
    } else {
        1
    }
}
#[cfg(windows)]
fn elevate(id: &str) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError},
        System::Threading::{WaitForSingleObject, INFINITE},
        UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW},
    };
    let exe = std::env::current_exe().map_err(|_| "找不到当前客户端程序")?;
    let file: Vec<u16> = exe.as_os_str().encode_wide().chain(Some(0)).collect();
    let args: Vec<u16> = format!("--codeseam-network-helper {id}")
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let verb: Vec<u16> = "runas\0".encode_utf16().collect();
    unsafe {
        let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
        info.cbSize = std::mem::size_of_val(&info) as u32;
        info.fMask = SEE_MASK_NOCLOSEPROCESS;
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.lpParameters = args.as_ptr();
        info.nShow = 0;
        if ShellExecuteExW(&mut info) == 0 {
            let code = GetLastError();
            return Err(if code == 1223 {
                "UAC 已取消；系统配置未修改".into()
            } else {
                format!("无法请求 Windows 管理员权限（{code}）")
            });
        }
        if info.hProcess.is_null() {
            return Err("未取得提权进程句柄；请重新检测配置".into());
        }
        WaitForSingleObject(info.hProcess, INFINITE);
        CloseHandle(info.hProcess);
    }
    Ok(())
}
#[cfg(not(windows))]
fn elevate(_: &str) -> Result<(), String> {
    Err("系统网络修改目前仅支持 Windows".into())
}
fn run_change(op: &str, plan: &Plan) -> Result<Value, String> {
    let id = token();
    let dir = operations_dir()?;
    let request = dir.join(format!("{id}.request.json"));
    let result = dir.join(format!("{id}.result.json"));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&request)
        .map_err(|_| "无法建立提权请求")?;
    file.write_all(
        &serde_json::to_vec(&HelperRequest {
            op: op.into(),
            plan: plan.clone(),
        })
        .map_err(|_| "请求序列化失败")?,
    )
    .map_err(|_| "无法写入提权请求")?;
    drop(file);
    let elevated = elevate(&id);
    let v = if elevated.is_ok() {
        fs::read(&result)
            .map_err(|_| "提权进程未返回结果；备份已保留，请重新检测后恢复".to_string())
            .and_then(|b| {
                serde_json::from_slice::<Value>(&b).map_err(|_| "提权结果格式错误".into())
            })
    } else {
        Err(elevated.unwrap_err())
    };
    let _ = fs::remove_file(&request);
    let _ = fs::remove_file(&result);
    v
}
fn backup_summary(action: &str) -> Value {
    match load_backup(action) {
        Ok(Some(b)) => {
            json!({"exists":true,"phase":b.phase,"appliedAt":b.applied_at,"adapterIds":b.plan.change.adapter_ids})
        }
        Ok(None) => json!({"exists":false}),
        Err(_) => json!({"exists":true,"phase":"unreadable"}),
    }
}
pub async fn inspect() -> Result<Value, String> {
    inspect_selected(true, true).await
}
pub async fn inspect_ipv6() -> Result<Value, String> {
    inspect_selected(false, true).await
}
async fn inspect_selected(dns: bool, ipv6_probe: bool) -> Result<Value, String> {
    let mut v = tokio::task::spawn_blocking(move || read_config(dns))
        .await
        .map_err(|_| "系统检测任务中断")??;
    v["generatedAt"] = json!(super::now());
    v["backups"] = json!({"ipv6":backup_summary("disable_ipv6"),"dns":backup_summary("set_dns")});
    let applied = v["backups"]["ipv6"]["appliedAt"].as_u64().unwrap_or(0);
    // 系统原本已关闭时可能没有 CodeSeam 备份。此时仍须通过下方的实时绑定、地址、路由和探测检查，
    // 不凭空设置待重启状态。
    let preexisting = applied == 0 && v["state"]["ipv6RegistryValue"] == 255;
    v["ipv6PreexistingClosure"] = json!(preexisting);
    v["ipv6RebootVerified"] = json!(
        preexisting || (applied > 0 && v["state"]["bootTime"].as_u64().unwrap_or(0) > applied)
    );
    let ipv6 = reqwest::Client::builder()
        .no_proxy()
        .local_address(std::net::IpAddr::V6(std::net::Ipv6Addr::UNSPECIFIED))
        .timeout(Duration::from_secs(5))
        .build();
    v["ipv6Probe"] = if !ipv6_probe {
        json!({"notChecked":true})
    } else {
        match ipv6 {
            Ok(client) => match client
                .get("https://api6.ipify.org?format=json")
                .send()
                .await
            {
                Ok(r) if r.status().is_success() => r
                    .json::<Value>()
                    .await
                    .unwrap_or_else(|_| json!({"error":"IPv6 端点返回无效响应"})),
                _ => json!({"error":"系统 IPv6 公网请求未成功；不单独作为已关闭的证明"}),
            },
            Err(_) => json!({"error":"无法创建 IPv6 系统探针"}),
        }
    };
    Ok(v)
}
impl SystemNetwork {
    pub async fn report_one(&self, id: &str) -> Result<Check, String> {
        if !matches!(id, "local_ipv6" | "system_dns") {
            return Err("不支持的系统检查".into());
        }
        let _lock = self.lock.lock().await;
        let value = inspect_selected(id == "system_dns", id == "local_ipv6").await?;
        checks(&value)
            .into_iter()
            .find(|c| c.id == id)
            .ok_or_else(|| "系统检测未返回结果".into())
    }
    pub async fn report_checks(&self) -> Vec<Check> {
        let _lock = self.lock.lock().await;
        match inspect().await {
            Ok(v) => checks(&v),
            Err(e) => vec![Check {
                id: "system_dns".into(),
                label: "系统网络检测".into(),
                status: "unknown".into(),
                detail: e,
                evidence: None,
                protected: false,
                remediation: None,
            }],
        }
    }
}
fn preexisting_closure(v: &Value) -> bool {
    v["ipv6PreexistingClosure"] == true
}
pub fn checks(v: &Value) -> Vec<Check> {
    let state = &v["state"];
    let enabled = state["adapters"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|a| a["ipv6Enabled"] == true && a["status"] != "Not Present")
                .count()
        })
        .unwrap_or(0);
    let configured = state["ipv6RegistryValue"] == 255;
    let mut ipv6=Check{id:"local_ipv6".into(),label:"系统 IPv6".into(),status:"unknown".into(),detail:format!("启用绑定 {enabled}；全局关闭配置{}；{}",if configured{"已写入"}else{"未设置"},if configured{"全局协议状态需结合重启与路由复查"}else{"当前未全局关闭"}),evidence:Some(json!({"adapters":state["adapters"],"registry":state["ipv6RegistryValue"],"routes":state["ipv6Routes"],"addresses":state["ipv6Addresses"]}).to_string()),protected:false,remediation:None};
    if enabled > 0 || !configured {
        ipv6.status = "warning".into();
        ipv6.remediation = Some("在下方选择关闭 IPv6 并应用".into());
    }
    if enabled == 0 && configured {
        ipv6.status = "reboot_required".into();
        ipv6.detail =
            "全部已枚举网卡 IPv6 绑定关闭；全局关闭配置已写入，请重启后复测（保留系统回环）".into();
        if v["ipv6RebootVerified"] == true
            && state["ipv6Routes"].as_array().is_some_and(|a| a.is_empty())
            && state["ipv6Addresses"]
                .as_array()
                .is_some_and(|a| a.is_empty())
            && v["ipv6Probe"]["ip"].is_null()
            && v["ipv6Probe"]["notChecked"] != true
        {
            ipv6.status = "pass".into();
            ipv6.detail = if preexisting_closure(v) {"IPv6 已关闭；网卡绑定关闭，未发现外部 IPv6 地址或默认路由，公网探针未连接（保留回环）"} else {"关闭配置已在重启后复查；网卡绑定关闭，未发现外部 IPv6 地址或默认路由，公网探针未连接（保留回环）"}.into();
        }
    }
    if configured
        && v["ipv6Probe"]["ip"]
            .as_str()
            .is_some_and(|ip| ip.parse::<std::net::Ipv6Addr>().is_ok())
    {
        ipv6.status = "fail".into();
        ipv6.detail =
            "已设置关闭 IPv6，但系统 IPv6 公网请求仍然成功，请检查重启及网络接管状态".into();
    }
    ipv6.evidence = Some(json!({"adapters":state["adapters"],"registry":state["ipv6RegistryValue"],"routes":state["ipv6Routes"],"addresses":state["ipv6Addresses"],"publicProbe":v["ipv6Probe"],"rebootVerified":v["ipv6RebootVerified"]}).to_string());
    let probe = &v["probe"];
    let dns=Check{id:"system_dns".into(),label:"系统 DNS 实测".into(),status:if probe["answers"].as_array().is_some_and(|a|!a.is_empty()){"warning"}else{"unknown"}.into(),detail:format!("默认解析{}；递归 DNS 出口观测 {}；此结果不单独证明无泄漏",if probe["answers"].as_array().is_some_and(|a|!a.is_empty()){"成功"}else{"未成功"},probe["resolverEgress"]),evidence:Some(json!({"probe":probe,"adapters":state["adapters"],"dohSupported":state["dohSupported"],"nrptRules":state["nrptRules"]}).to_string()),protected:false,remediation:Some("在系统网络配置中核对网卡 DNS；更换公共 DNS 不等于查询已通过代理或已加密".into())};
    vec![ipv6, dns]
}
#[tauri::command]
pub async fn cs_system_network_inspect(
    state: tauri::State<'_, SystemNetwork>,
    configuration_only: Option<bool>,
) -> Result<Value, String> {
    let _lock = state.lock.lock().await;
    if configuration_only == Some(true) {
        inspect_selected(false, false).await
    } else {
        inspect().await
    }
}
#[tauri::command]
pub async fn cs_system_network_plan(
    state: tauri::State<'_, SystemNetwork>,
    change: Change,
) -> Result<Value, String> {
    let _lock = state.lock.lock().await;
    change.validate()?;
    if load_backup(&change.action)?.is_some() {
        return Err("已有该类系统网络备份；请先恢复原配置，再应用新方案".into());
    }
    if change.preset.as_deref() == Some("proxy") {
        let verified=tokio::task::spawn_blocking(|| powershell_source(json!({}), "try {$v=@(Resolve-DnsName www.microsoft.com -Type A -Server 127.0.0.1 -DnsOnly -QuickTimeout -ErrorAction Stop); @{ok=($v.Count -gt 0)}|ConvertTo-Json -Compress} catch { '{\"ok\":false}' }")).await.map_err(|_|"代理 DNS 检测中断")??;
        if verified["ok"] != true {
            return Err("本机代理 DNS 未响应，请先在代理软件中启用 127.0.0.1:53 DNS 服务".into());
        }
    }
    let before = tokio::task::spawn_blocking(|| read_config(false))
        .await
        .map_err(|_| "系统读取任务中断")??;
    let plan = Plan {
        id: token(),
        created_at: super::now(),
        change,
        before: before["state"].clone(),
    };
    validate_plan(&plan)?;
    vault::save(
        PLAN,
        &serde_json::to_vec(&plan).map_err(|_| "预览序列化失败")?,
    )?;
    Ok(
        json!({"id":plan.id,"createdAt":plan.created_at,"change":plan.change,"before":plan.before,"profile":if plan.change.action=="set_dns"{profile(plan.change.preset.as_deref())?}else{Value::Null},"requiresElevation":true,"requiresReboot":plan.change.action=="disable_ipv6"}),
    )
}
#[tauri::command]
pub async fn cs_system_network_apply(
    state: tauri::State<'_, SystemNetwork>,
    plan_id: String,
) -> Result<Value, String> {
    let _lock = state.lock.lock().await;
    let bytes = vault::read(PLAN)?.ok_or("请先预览改动")?;
    let plan: Plan = serde_json::from_slice(&bytes).map_err(|_| "改动预览损坏")?;
    if plan.id != plan_id || super::now().saturating_sub(plan.created_at) > 600 {
        return Err("预览已失效，请重新预览".into());
    }
    validate_plan(&plan)?;
    let path = backup_file(&plan.change.action)?;
    if load_backup(&plan.change.action)?.is_some() {
        return Err("备份已存在，请先恢复原配置".into());
    }
    let mut backup = Backup {
        plan: plan.clone(),
        phase: "pending".into(),
        applied_at: super::now(),
    };
    vault::save(
        path,
        &serde_json::to_vec(&backup).map_err(|_| "备份序列化失败")?,
    )?;
    let response = tokio::task::spawn_blocking(move || run_change("apply", &plan))
        .await
        .map_err(|_| "系统修改任务中断；备份已保留")?;
    match response {
        Ok(v) if v["ok"] == true => {
            backup.phase = "applied".into();
            vault::save(
                path,
                &serde_json::to_vec(&backup).map_err(|_| "备份更新失败")?,
            )?;
            vault::remove(PLAN)?;
            Ok(v)
        }
        Ok(v) => {
            if v["rolledBack"] == true {
                vault::remove(path)?;
            }
            Err(format!(
                "{}；{}",
                v["error"].as_str().unwrap_or("系统修改失败"),
                if v["rolledBack"] == true {
                    "已自动回滚"
                } else {
                    "已保留备份，请检测后恢复原配置"
                }
            ))
        }
        Err(e) => {
            if e.starts_with("UAC 已取消") || e.starts_with("无法请求 Windows 管理员权限")
            {
                vault::remove(path)?;
            }
            Err(e)
        }
    }
}
#[tauri::command]
pub async fn cs_system_network_restore(
    state: tauri::State<'_, SystemNetwork>,
    action: String,
) -> Result<Value, String> {
    let _lock = state.lock.lock().await;
    let b = load_backup(&action)?.ok_or("没有待恢复的系统网络配置")?;
    validate_plan(&b.plan)?;
    let v = tokio::task::spawn_blocking(move || run_change("restore", &b.plan))
        .await
        .map_err(|_| "系统恢复任务中断；备份已保留")??;
    if v["ok"] != true {
        return Err(format!(
            "{}；原备份已保留",
            v["error"].as_str().unwrap_or("系统恢复失败")
        ));
    }
    vault::remove(backup_file(&action)?)?;
    Ok(v)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_untrusted_operations() {
        assert!(!valid_token("../x"));
        assert!(!valid_guid("x'; reboot"));
        let mut c = Change {
            action: "set_dns".into(),
            adapter_ids: vec!["51a8d43c-d40d-489b-95cc-b047e784672f".into()],
            preset: Some("quad9".into()),
            doh: false,
        };
        assert!(c.validate().is_ok());
        c.preset = Some("https://arbitrary.example".into());
        assert!(c.validate().is_err());
        c.preset = Some("quad9".into());
        c.adapter_ids.push(c.adapter_ids[0].clone());
        assert!(c.validate().is_err());
    }
    #[test]
    fn unavailable_probe_does_not_pass() {
        let c = checks(&json!({"state":{"adapters":[]},"probe":{}}));
        assert!(c.iter().all(|c| c.status != "pass"));
    }
    #[test]
    fn ipv6_closure_requires_post_reboot_observations() {
        let mut v = json!({"state":{"adapters":[{"ipv6Enabled":false,"status":"Up"}],"ipv6RegistryValue":255,"ipv6Routes":[],"ipv6Addresses":[]},"ipv6Probe":{"error":"no route"},"ipv6RebootVerified":false});
        assert_eq!(checks(&v)[0].status, "reboot_required");
        v["ipv6RebootVerified"] = json!(true);
        assert_eq!(checks(&v)[0].status, "pass");
        v["ipv6Probe"] = json!({"notChecked":true});
        assert_ne!(checks(&v)[0].status, "pass");
        v["ipv6Probe"] = json!({"ip":"2001:db8::1"});
        assert_eq!(checks(&v)[0].status, "fail");
    }
    #[cfg(windows)]
    #[test]
    fn padded_dns_values_drift_guard_and_mixed_restore() {
        let id = "51a8d43c-d40d-489b-95cc-b047e784672f";
        let request = json!({"action":"set_dns","adapterIds":[id],"doh":false,"profile":{"servers":["9.9.9.9","149.112.112.112","2620:fe::fe","2620:fe::9"]},"before":{"adapters":[{"id":id,"index":12,"name":"fixture","dns4":["10.0.0.1"],"static4":[],"dns6":["2001:db8::53"],"static6":["2001:db8::53"]}]},"after":{"adapters":[{"id":id,"index":12,"name":"fixture","dns4":["9.9.9.9","149.112.112.112"],"static4":["9.9.9.9","149.112.112.112"],"dns6":["2620:fe::fe","2620:fe::9"],"static6":["2620:fe::fe","2620:fe::9"]}]}});
        let functions = SCRIPT.split("\ntry {").next().unwrap();
        // 使用实际事务函数，并将所有修改操作替换为内存模拟对象。
        // 此测试不会更改任何 Windows 网络设置。
        let body = r#"
$global:fixtureState=($Request.after|ConvertTo-Json -Depth 20|ConvertFrom-Json)
$global:writes=@()
function Get-State { $global:fixtureState }
function Get-DnsClientServerAddress {param($InterfaceIndex,$AddressFamily) [pscustomobject]@{InterfaceIndex=$InterfaceIndex;AddressFamily=$AddressFamily}}
function Set-DnsClientServerAddress {
 param($InputObject,[string[]]$ServerAddresses,[switch]$ResetServerAddresses,[switch]$Validate)
 $family=if($InputObject.AddressFamily -eq 2){'4'}else{'6'}; $static='static'+$family; $dns='dns'+$family
 $a=$global:fixtureState.adapters[0]
 if($ResetServerAddresses){$a.$static=@();$a.$dns=@($Request.before.adapters[0].$dns);$global:writes+=($family+':dhcp')}
 else{$a.$static=@($ServerAddresses);$a.$dns=@($ServerAddresses);$global:writes+=($family+':static')}
}
function Clear-DnsClientCache {}
try {
 $addresses=@(Addresses ('9.9.9.9,149.112.112.112'+[char]0+[char]0))
 $global:fixtureState.adapters[0].static4=@('8.8.8.8')
 $blocked=$false;try{Check-Guard (Get-State) $true}catch{$blocked=$true}
 if(!$blocked -or $global:writes.Count){throw 'Drift must refuse all writes'}
 $global:fixtureState=($Request.after|ConvertTo-Json -Depth 20|ConvertFrom-Json)
 Restore-Settings;Verify-Settings (Get-State) $true
 [pscustomobject]@{ok=$true;addresses=$addresses;blocked=$blocked;writes=$global:writes}|ConvertTo-Json -Compress
}catch{[pscustomobject]@{ok=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress}
"#;
        let value = powershell_source(request, &format!("{functions}\n{body}")).unwrap();
        assert_eq!(value["ok"], true, "{value}");
        assert_eq!(value["addresses"], json!(["9.9.9.9", "149.112.112.112"]));
        assert_eq!(value["writes"], json!(["4:dhcp", "6:static"]));
        assert_eq!(value["blocked"], true);
    }
    #[test]
    #[ignore = "read-only real Windows DNS and adapters"]
    fn live_inspection() {
        let data = read_config(true).unwrap();
        println!("{}", data);
        assert!(data["state"]["adapters"]
            .as_array()
            .is_some_and(|a| !a.is_empty()));
        if let Ok(p) = std::env::var("CODESEAM_SYSTEM_NETWORK_REPORT") {
            fs::write(p, serde_json::to_vec_pretty(&data).unwrap()).unwrap();
        }
    }
}

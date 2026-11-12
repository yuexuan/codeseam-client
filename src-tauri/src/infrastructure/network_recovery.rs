//! Windows 系统网络变更由固定操作的 UAC 辅助程序预览、备份并执行。
//! 只有未提权的父进程会写入 DPAPI 备份。
use super::vault;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    time::{SystemTime, UNIX_EPOCH},
};

const SCRIPT: &str = include_str!("system_network.ps1");
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
    let mut child=super::windows::hidden(executable.to_str().ok_or("Windows 路径无效")?)
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
        if req.op != "restore" {
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

pub fn restore(action: &str) -> Result<(), String> {
    let backup = load_backup(action)?.ok_or("没有待恢复的系统网络配置")?;
    let result = run_change("restore", &backup.plan)?;
    if result["ok"] != true {
        return Err(format!("系统网络恢复失败；备份已保留：{}", result["error"]));
    }
    vault::remove(backup_file(action)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tampered_actions_and_adapter_identities_are_rejected_before_elevation() {
        let mut change = Change {
            action: "delete_files".into(),
            adapter_ids: vec!["51a8d43c-d40d-489b-95cc-b047e784672f".into()],
            preset: None,
            doh: false,
        };
        assert!(change.validate().is_err());
        change.action = "disable_ipv6".into();
        change.adapter_ids = vec!["../external".into()];
        assert!(change.validate().is_err());
        assert!(!valid_token("../external"));
        let plan = Plan {
            id: "0".repeat(32),
            created_at: 1,
            change,
            before: serde_json::json!({}),
        };
        assert!(payload("restore", &plan).is_err());
    }
}

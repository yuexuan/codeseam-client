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
#[derive(Clone, Serialize, Deserialize)]
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
        if !matches!(
            self.action.as_str(),
            "disable_ipv6" | "set_dns" | "set_timezone" | "enable_time_sync"
        ) {
            return Err("不支持的系统网络操作".into());
        }
        if self.action == "enable_time_sync" {
            return if self.adapter_ids.is_empty() && self.preset.is_none() && !self.doh {
                Ok(())
            } else {
                Err("时间同步操作不可附带其他参数".into())
            };
        }
        if self.action == "set_timezone" {
            if !self.adapter_ids.is_empty()
                || self.doh
                || !matches!(
                    self.preset.as_deref(),
                    Some(
                        "Singapore Standard Time"
                            | "China Standard Time"
                            | "Tokyo Standard Time"
                            | "UTC"
                            | "Pacific Standard Time"
                            | "Mountain Standard Time"
                            | "Central Standard Time"
                            | "Eastern Standard Time"
                            | "GMT Standard Time"
                            | "W. Europe Standard Time"
                    )
                )
            {
                return Err("请选择受支持的目标时区".into());
            }
            return Ok(());
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
        "set_timezone" => Ok("system-timezone-backup.dpapi"),
        "enable_time_sync" => Ok("system-time-sync-backup.dpapi"),
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
    if plan.change.action == "enable_time_sync" {
        return if plan.before["timeSync"]["running"].is_boolean()
            && matches!(
                plan.before["timeSync"]["startMode"].as_str(),
                Some("Auto" | "Manual" | "Disabled")
            ) {
            Ok(())
        } else {
            Err("时间服务快照缺失".into())
        };
    }
    if plan.change.action == "set_timezone" {
        return if plan.before["timezone"].as_str().is_some() {
            Ok(())
        } else {
            Err("时区快照缺失".into())
        };
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
        json!({"op":op,"action":plan.change.action,"adapterIds":plan.change.adapter_ids,"doh":plan.change.doh,"profile":if plan.change.action=="set_dns"{profile(plan.change.preset.as_deref())?}else{Value::Null},"before":plan.before,"timezone":plan.change.preset}),
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
        if !matches!(req.op.as_str(), "restore" | "apply") {
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

// 为每个受管理的适配器保留首次快照。执行计划使用独立快照记录当前状态，
// 以便检查并发状态变化并在失败时回滚。
fn recovery_plan(previous: Option<&Backup>, current: &Plan) -> Result<Plan, String> {
    let Some(previous) = previous else {
        return Ok(current.clone());
    };
    if previous.phase != "applied" {
        return Err("上次设置未完成且结果尚未确认，请先检查并恢复异常操作".into());
    }
    let mut plan = previous.plan.clone();
    plan.change.preset = current.change.preset.clone();
    for id in &current.change.adapter_ids {
        if !plan.change.adapter_ids.contains(id) {
            let adapter = current.before["adapters"]
                .as_array()
                .and_then(|adapters| adapters.iter().find(|a| a["id"].as_str() == Some(id)))
                .ok_or("新网卡缺少原始快照")?
                .clone();
            plan.before["adapters"]
                .as_array_mut()
                .ok_or("原始网卡快照缺失")?
                .retain(|a| a["id"].as_str() != Some(id));
            plan.before["adapters"]
                .as_array_mut()
                .unwrap()
                .push(adapter);
            plan.change.adapter_ids.push(id.clone());
        }
    }
    Ok(plan)
}

fn save_backup(file: &str, backup: &Backup) -> Result<(), String> {
    vault::save(
        file,
        &serde_json::to_vec(backup).map_err(|e| e.to_string())?,
    )
}

fn restore_previous_backup(file: &str, previous: Option<&Backup>) -> Result<(), String> {
    match previous {
        Some(backup) => save_backup(file, backup),
        None => vault::remove(file),
    }
}

/// 运行时功能共用固定操作辅助程序和加密恢复日志。
pub fn apply_runtime(action: &str, target: Option<String>) -> Result<(), String> {
    let file = backup_file(action)?;
    let previous = load_backup(action)?;
    let snapshot = powershell(json!({"op":"read"}))?;
    if snapshot["ok"] != true {
        return Err(format!("无法读取系统设置：{}", snapshot["error"]));
    }
    let before = snapshot["data"]["state"].clone();
    let adapters = before["adapters"].as_array().ok_or("缺少网卡快照")?;
    if action == "disable_ipv6"
        && previous.as_ref().is_none_or(|b| b.phase == "applied")
        && before["ipv6RegistryExists"] == true
        && before["ipv6RegistryValue"] == 255
        && adapters
            .iter()
            .filter(|a| a["status"] != "Not Present")
            .all(|a| a["ipv6Enabled"] != true)
    {
        return Ok(());
    }
    let adapter_ids = adapters
        .iter()
        .filter(|a| {
            if action == "disable_ipv6" {
                a["ipv6Enabled"].is_boolean() && a["status"] != "Not Present"
            } else if action == "set_dns" {
                a["dnsAvailable"] == true && a["status"] == "Up"
            } else {
                false
            }
        })
        .filter_map(|a| a["id"].as_str().map(str::to_owned))
        .collect();
    let plan = Plan {
        id: token(),
        created_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs(),
        change: Change {
            action: action.into(),
            adapter_ids,
            preset: target,
            doh: false,
        },
        before,
    };
    validate_plan(&plan)?;
    let recovery = recovery_plan(previous.as_ref(), &plan)?;
    vault::save(
        file,
        &serde_json::to_vec(&Backup {
            plan: recovery.clone(),
            phase: "pending".into(),
            applied_at: plan.created_at,
        })
        .map_err(|e| e.to_string())?,
    )?;
    let result = match run_change("apply", &plan) {
        Ok(result) => result,
        Err(error) => {
            if error.starts_with("UAC 已取消") {
                restore_previous_backup(file, previous.as_ref())?;
            }
            return Err(error);
        }
    };
    if result["ok"] != true {
        if result["rolledBack"] == true || result["unchanged"] == true {
            restore_previous_backup(file, previous.as_ref())?;
        }
        return Err(format!(
            "设置失败：{}；回滚结果：{}；{}",
            result["error"], result["rolledBack"], result["rollbackError"]
        ));
    }
    vault::save(
        file,
        &serde_json::to_vec(&Backup {
            plan: recovery,
            phase: "applied".into(),
            applied_at: plan.created_at,
        })
        .map_err(|e| e.to_string())?,
    )
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
    fn ipv6_plan(ids: &[(&str, bool)]) -> Plan {
        Plan {
            id: "a".repeat(32),
            created_at: 1,
            change: Change {
                action: "disable_ipv6".into(),
                adapter_ids: ids.iter().map(|(id, _)| id.to_string()).collect(),
                preset: None,
                doh: false,
            },
            before: json!({"ipv6RegistryExists":false,"ipv6RegistryValue":null,
                "adapters":ids.iter().map(|(id, enabled)| json!({"id":id,"ipv6Enabled":enabled,"status":"Up"})).collect::<Vec<_>>() }),
        }
    }
    #[test]
    fn repeated_apply_preserves_originals_and_adds_new_adapters() {
        let old = "51a8d43c-d40d-489b-95cc-b047e784672f";
        let new = "51a8d43c-d40d-489b-95cc-b047e7846730";
        let previous = Backup {
            plan: ipv6_plan(&[(old, true)]),
            phase: "applied".into(),
            applied_at: 1,
        };
        let mut current = ipv6_plan(&[(old, false), (new, true)]);
        current.before["ipv6RegistryExists"] = json!(true);
        current.before["ipv6RegistryValue"] = json!(255);
        let merged = recovery_plan(Some(&previous), &current).unwrap();
        assert_eq!(merged.before["adapters"][0]["ipv6Enabled"], true);
        assert_eq!(merged.before["adapters"][1]["ipv6Enabled"], true);
        assert_eq!(merged.before["ipv6RegistryExists"], false);
        assert_eq!(current.before["adapters"][0]["ipv6Enabled"], false);
        assert!(validate_plan(&merged).is_ok());
        let again = Backup {
            plan: merged,
            ..previous
        };
        assert_eq!(
            recovery_plan(Some(&again), &current)
                .unwrap()
                .change
                .adapter_ids
                .len(),
            2
        );
    }
    #[test]
    fn missing_adapters_remain_in_recovery_and_pending_operations_are_blocked() {
        let old = "51a8d43c-d40d-489b-95cc-b047e784672f";
        let mut previous = Backup {
            plan: ipv6_plan(&[(old, true)]),
            phase: "applied".into(),
            applied_at: 1,
        };
        assert_eq!(
            recovery_plan(Some(&previous), &ipv6_plan(&[]))
                .unwrap()
                .change
                .adapter_ids,
            vec![old]
        );
        previous.phase = "pending".into();
        assert!(recovery_plan(Some(&previous), &ipv6_plan(&[])).is_err());
    }
    #[test]
    fn repeated_timezone_change_keeps_first_value_and_latest_target() {
        let mut first = ipv6_plan(&[]);
        first.change.action = "set_timezone".into();
        first.change.preset = Some("Singapore Standard Time".into());
        first.before = json!({"timezone":"China Standard Time"});
        let previous = Backup {
            plan: first.clone(),
            phase: "applied".into(),
            applied_at: 1,
        };
        first.before = json!({"timezone":"Singapore Standard Time"});
        first.change.preset = Some("Tokyo Standard Time".into());
        let merged = recovery_plan(Some(&previous), &first).unwrap();
        assert_eq!(merged.before["timezone"], "China Standard Time");
        assert_eq!(merged.change.preset.as_deref(), Some("Tokyo Standard Time"));
    }
    #[test]
    fn time_sync_operation_accepts_only_its_own_fixed_parameters() {
        let mut change = Change {
            action: "enable_time_sync".into(),
            adapter_ids: vec![],
            preset: None,
            doh: false,
        };
        assert!(change.validate().is_ok());
        change.preset = Some("arbitrary".into());
        assert!(change.validate().is_err());
        change.preset = None;
        change.doh = true;
        assert!(change.validate().is_err());
    }
    #[test]
    fn timezone_targets_and_full_ipv6_scope_are_validated() {
        let mut plan = Plan {
            id: "a".repeat(32),
            created_at: 1,
            change: Change {
                action: "set_timezone".into(),
                adapter_ids: vec![],
                preset: Some("Singapore Standard Time".into()),
                doh: false,
            },
            before: json!({"timezone":"China Standard Time"}),
        };
        assert!(validate_plan(&plan).is_ok());
        assert_eq!(
            payload("apply", &plan).unwrap()["timezone"],
            "Singapore Standard Time"
        );
        plan.change.preset = Some("invalid; command".into());
        assert!(validate_plan(&plan).is_err());
        plan.change = Change {
            action: "disable_ipv6".into(),
            adapter_ids: vec!["51a8d43c-d40d-489b-95cc-b047e784672f".into()],
            preset: None,
            doh: false,
        };
        plan.before = json!({"adapters":[
            {"id":"51a8d43c-d40d-489b-95cc-b047e784672f","ipv6Enabled":true,"status":"Up"},
            {"id":"51a8d43c-d40d-489b-95cc-b047e7846730","ipv6Enabled":true,"status":"Disconnected"}
        ]});
        assert!(validate_plan(&plan).is_err());
        plan.change
            .adapter_ids
            .push("51a8d43c-d40d-489b-95cc-b047e7846730".into());
        assert!(validate_plan(&plan).is_ok());
    }
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

//! 日常状态观察和单一候选运行环境；仅在最终校验通过后提交。
use crate::infrastructure::{vault, windows};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};

pub fn observe(record: &Value, action: &str) -> Result<Value, String> {
    let profile = &record["baseline"]["profile"];
    let snapshot_script = if action == "read_browser" {
        include_str!("../infrastructure/daily_browser.ps1").to_string()
    } else {
        include_str!("../infrastructure/runtime_snapshot.ps1").replace("# WORKBENCH_PROCESSES", include_str!("../infrastructure/workbench.ps1"))
    };
    let snapshot_script = if action == "read_all" {
        snapshot_script.replace("# DAILY_BROWSER_SNAPSHOT", include_str!("../infrastructure/daily_browser.ps1"))
    } else { snapshot_script };
    if record["virtualRuntime"] == true {
        let action = if matches!(action, "read" | "read_browser" | "read_all") { "observe" } else { action };
        return serde_json::from_str(&super::virtual_runtime::execute(action.into(), json!({"profile":profile,"script":snapshot_script,"worker":include_str!("../infrastructure/browser_worker.ps1")}).to_string())?).map_err(|e| e.to_string());
    }
    if action == "open_console" {
        return Err("本机运行没有虚拟机窗口".into());
    }
    let data = STANDARD.encode(json!({"action":action,"profile":profile,"worker":include_str!("../infrastructure/browser_worker.ps1")}).to_string());
    let script = format!("$r = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{data}')) | ConvertFrom-Json\n$s = & {{ {} }} $r.action $r.profile $false $r.worker\n$s | ConvertTo-Json -Depth 15 -Compress", snapshot_script);
    let mut value: Value = windows::run_script(script.as_bytes())?;
    if action == "read_browser" { value["at"] = json!(now()); value["online"] = json!(true); return Ok(value); }
    if action == "pause_apps" || action == "unlock_apps" {
        return Ok(value);
    }
    value["at"] = json!(now());
    value["name"] = json!("本机 Windows");
    value["state"] = json!("Running");
    value["online"] = json!(true);
    value["platform"] = json!("Native · 当前 Windows 用户");
    value["error"] = Value::Null;
    let runtime = super::runtime::read()?;
    for (id, source) in [("exit", "exit"), ("dns", "dns")] {
        if let Some(check) = runtime.checks.iter().find(|c| c.id == source) {
            if let Some(target) = value["checks"]
                .as_array_mut()
                .and_then(|checks| checks.iter_mut().find(|c| c["id"] == id))
            {
                target["value"] = json!(check.value);
                target["status"] =
                    serde_json::to_value(&check.status).map_err(|e| e.to_string())?;
                target["label"] = json!(
                    if matches!(check.status, crate::domain::Status::Satisfied) {
                        "已复验"
                    } else {
                        "待复验"
                    }
                );
            }
        }
    }
    value["exitIp"] = json!(runtime.node.exit_ip);
    value["runtime"] = serde_json::to_value(runtime).map_err(|e| e.to_string())?;
    Ok(value)
}
fn now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system time")
        .as_secs()
        .to_string()
}

pub fn begin(record: &mut Value, input: &Value) -> Result<(), String> {
    if record["nodeRepair"].is_object() { return Err("请先完成节点修复后再切换运行环境".into()); }
    if record["reconfiguration"].is_object() {
        return Err("已有运行环境重新配置任务，请继续或取消该任务".into());
    }
    let target = input["virtualRuntime"]
        .as_bool()
        .ok_or("缺少目标运行环境")?;
    if record["virtualRuntime"] == target {
        return Err("请选择另一种运行环境；日常维护无需重新配置".into());
    }
    // 任何准备操作前，先保留不可变的正式基线和 Native 检查点。
    let backup = format!(
        "RuntimeHistory/{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    );
    std::fs::create_dir_all(vault::dir()?.join(&backup)).map_err(|e| e.to_string())?;
    for name in [
        "workbench-v1.dpapi",
        "runtime-v1.dpapi",
        "virtual-node-v1.dpapi",
    ] {
        if let Some(bytes) = vault::read(name)? {
            vault::save(&format!("{backup}/{name}"), &bytes)?;
        }
    }
    observe(record, "pause_apps")?;
    record["reconfiguration"] = json!({"virtualRuntime":target,"startedAt":now(),"backup":backup});
    Ok(())
}
pub fn cancel(record: &mut Value) -> Result<(), String> {
    let backup = record["reconfiguration"]["backup"]
        .as_str()
        .ok_or("没有待取消的运行环境任务")?;
    // 准备期间仅可修改 Native 确认检查点。
    // Guest 虚拟机和配置数据保持原位，绝不复制到目标环境。
    if let Some(bytes) = vault::read(&format!("{backup}/runtime-v1.dpapi"))? {
        vault::save("runtime-v1.dpapi", &bytes)?;
    } else {
        vault::remove("runtime-v1.dpapi")?;
    }
    record["reconfiguration"] = Value::Null;
    record["observation"] = Value::Null;
    Ok(())
}

pub fn validate_confirmation(
    previous: Option<&Value>,
    target: Option<bool>,
) -> Result<bool, String> {
    if let Some(record) = previous {
        if !record["reconfiguration"].is_object() {
            return Err("已有正式基线，请从工作台查看当前环境".into());
        }
        if record["reconfiguration"]["virtualRuntime"].as_bool() != target {
            return Err("目标运行环境与重新配置任务不一致".into());
        }
    }
    target.ok_or_else(|| "缺少运行环境".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replacement_requires_explicit_switch_and_the_selected_target() {
        assert!(validate_confirmation(None, Some(true)).is_ok());
        assert!(validate_confirmation(Some(&json!({"virtualRuntime":true})), Some(false)).is_err());
        let old = json!({"virtualRuntime":true,"reconfiguration":{"virtualRuntime":false}});
        assert!(validate_confirmation(Some(&old), Some(true)).is_err());
        assert!(validate_confirmation(Some(&old), Some(false)).is_ok());
        assert_eq!(old["virtualRuntime"], true);
    }
    #[test]
    #[cfg(windows)]
    fn cancel_restores_checkpoint_and_keeps_formal_baseline_and_guest_data() {
        let _guard = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
        let root = std::env::temp_dir().join(format!("codeseam-reconfigure-{}", now()));
        let prior = std::env::var_os("CODESEAM_TEST_DATA_DIR");
        std::env::set_var("CODESEAM_TEST_DATA_DIR", &root);
        let outcome = std::panic::catch_unwind(|| {
            let data = vault::dir().unwrap();
            std::fs::create_dir_all(data.join("RuntimeHistory/test")).unwrap();
            std::fs::create_dir_all(data.join("Virtual")).unwrap();
            std::fs::write(data.join("Virtual/kept-profile.txt"), b"old guest data").unwrap();
            vault::save("RuntimeHistory/test/runtime-v1.dpapi", b"old checkpoint").unwrap();
            vault::save("runtime-v1.dpapi", b"candidate checkpoint").unwrap();
            let mut record = json!({"virtualRuntime":true,"baseline":{"profileId":"original"},"reconfiguration":{"virtualRuntime":false,"backup":"RuntimeHistory/test"}});
            cancel(&mut record).unwrap();
            assert_eq!(
                vault::read("runtime-v1.dpapi").unwrap().unwrap(),
                b"old checkpoint"
            );
            assert_eq!(record["virtualRuntime"], true);
            assert_eq!(record["baseline"]["profileId"], "original");
            assert!(record["reconfiguration"].is_null());
            assert_eq!(
                std::fs::read(data.join("Virtual/kept-profile.txt")).unwrap(),
                b"old guest data"
            );
        });
        match prior {
            Some(value) => std::env::set_var("CODESEAM_TEST_DATA_DIR", value),
            None => std::env::remove_var("CODESEAM_TEST_DATA_DIR"),
        };
        let resolved = root.canonicalize().unwrap();
        assert!(resolved.starts_with(std::env::temp_dir().canonicalize().unwrap()));
        std::fs::remove_dir_all(resolved).unwrap();
        if let Err(panic) = outcome {
            std::panic::resume_unwind(panic);
        }
    }
}

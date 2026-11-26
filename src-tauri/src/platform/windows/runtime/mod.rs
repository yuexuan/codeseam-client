use super::powershell;
use crate::domain::{runtime::RuntimeSetting, Check};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TimezoneTarget {
    pub windows_id: String,
    pub iana_id: String,
}
pub(crate) fn timezone_from_iana(iana: &str) -> Option<TimezoneTarget> {
    let windows = match iana {
        "America/Los_Angeles" | "America/Vancouver" => "Pacific Standard Time",
        "America/Denver" | "America/Edmonton" => "Mountain Standard Time",
        "America/Chicago" | "America/Winnipeg" => "Central Standard Time",
        "America/New_York" | "America/Toronto" | "America/Detroit" => "Eastern Standard Time",
        "Asia/Singapore" => "Singapore Standard Time",
        "Asia/Shanghai" | "Asia/Hong_Kong" => "China Standard Time",
        "Asia/Taipei" => "Taipei Standard Time",
        "Asia/Tokyo" => "Tokyo Standard Time",
        "Europe/London" => "GMT Standard Time",
        "Europe/Berlin" | "Europe/Amsterdam" => "W. Europe Standard Time",
        _ => return None,
    };
    // 浏览器提供 Windows 系统时区对应的标准 IANA 时区名称。
    let canonical = match windows {
        "Pacific Standard Time" => "America/Los_Angeles",
        "Mountain Standard Time" => "America/Denver",
        "Central Standard Time" => "America/Chicago",
        "Eastern Standard Time" => "America/New_York",
        "China Standard Time" => "Asia/Shanghai",
        "W. Europe Standard Time" => "Europe/Berlin",
        _ => iana,
    };
    Some(TimezoneTarget {
        windows_id: windows.into(),
        iana_id: canonical.into(),
    })
}
pub(crate) fn checks(target_timezone: Option<&str>) -> Result<Vec<Check>, String> {
    let target = STANDARD.encode(serde_json::to_vec(&target_timezone).map_err(|e| e.to_string())?);
    let script = format!("$TargetTimezone = ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{target}')) | ConvertFrom-Json);\n{}", include_str!("runtime.ps1"));
    powershell::run_script(script.as_bytes())
}

pub fn open_setting(setting: RuntimeSetting) -> Result<(), String> {
    let uri = match setting {
        RuntimeSetting::Language => "ms-settings:regionlanguage",
        _ => return Err("请使用应用内的一键设置".into()),
    };
    let status = super::managed_process::hidden("explorer.exe")
        .arg(uri)
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("无法打开 Windows 设置，请从开始菜单打开".into())
    }
}

pub(crate) fn snapshot(record: &Value, action: &str) -> Result<Value, String> {
    let profile = &record["baseline"]["profile"];
    let snapshot_script = if action == "read_browser" {
        include_str!("../browser/daily_browser.ps1").to_string()
    } else {
        include_str!("runtime_snapshot.ps1")
            .replace("# WORKBENCH_PROCESSES", include_str!("workbench.ps1"))
    };
    let snapshot_script = if action == "read_all" {
        snapshot_script.replace(
            "# DAILY_BROWSER_SNAPSHOT",
            include_str!("../browser/daily_browser.ps1"),
        )
    } else {
        snapshot_script
    };
    if record["virtualRuntime"] == true {
        let action = if matches!(action, "read" | "read_browser" | "read_all") {
            "observe"
        } else {
            action
        };
        return super::hyperv::run(
            action,
            json!({"profile":profile,"script":snapshot_script,"worker":super::browser::WORKER}),
            None,
        );
    }
    if action == "open_console" {
        return Err("本机运行没有虚拟机窗口".into());
    }
    let data = STANDARD.encode(
        json!({"action":action,"profile":profile,"worker":super::browser::WORKER}).to_string(),
    );
    let script = format!("$r = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{data}')) | ConvertFrom-Json\n$s = & {{ {} }} $r.action $r.profile $false $r.worker\n$s | ConvertTo-Json -Depth 15 -Compress", snapshot_script);
    let mut value: Value = powershell::run_script(script.as_bytes())?;
    if action == "read_browser" {
        value["at"] = json!(now());
        value["online"] = json!(true);
        return Ok(value);
    }
    if action == "unlock_apps" {
        return Ok(value);
    }
    value["at"] = json!(now());
    value["name"] = json!("本机 Windows");
    value["state"] = json!("Running");
    value["online"] = json!(true);
    value["platform"] = json!("Native · 当前 Windows 用户");
    value["error"] = Value::Null;
    Ok(value)
}

fn now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system time")
        .as_secs()
        .to_string()
}

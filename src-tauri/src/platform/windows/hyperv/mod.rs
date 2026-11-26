use super::powershell;
use crate::{
    domain::{nodes::NodeSummary, Check},
    infrastructure::vault,
};
use serde_json::{json, Value};
use std::time::Duration;

pub(crate) fn read_compatibility() -> Result<Vec<Check>, String> {
    powershell::run_script(include_bytes!("hyperv_compatibility.ps1"))
}

fn controller_script() -> String {
    // 文件 BOM 只允许出现在开头，不能插入到文件中间。
    include_str!("virtual_runtime.ps1")
        .trim_start_matches('\u{feff}')
        .replace(
            "# GUEST_FUNCTIONS",
            include_str!("guest_install.ps1").trim_start_matches('\u{feff}'),
        )
        .replace(
            "# GUEST_BROWSER",
            include_str!("guest_browser.ps1").trim_start_matches('\u{feff}'),
        )
        .replace("# DAILY_RUNTIME", include_str!("daily_virtual_runtime.ps1"))
        .replace("# NODE_REPAIR", include_str!("node_repair.ps1"))
        .replace(
            "# CONSOLE_DISPLAY",
            include_str!("console_display.ps1").trim_start_matches('\u{feff}'),
        )
}

pub(crate) fn run(action: &str, config: Value, node: Option<NodeSummary>) -> Result<Value, String> {
    let request = json!({"action": action, "config": config, "root": vault::dir()?.join("Virtual"), "node": node});
    let seconds = if action == "browser_prepare" {
        900
    } else {
        600
    };
    powershell::request(&controller_script(), &request, Duration::from_secs(seconds))
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn assembled_controller_parses_without_running_system_operations() {
        use base64::Engine;
        let script = super::controller_script();
        assert!(!script.contains('\u{feff}'));
        let encoded = base64::engine::general_purpose::STANDARD.encode(script.as_bytes());
        let probe = format!("$s = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}')); $null = [ScriptBlock]::Create($s); @{{parsed=$true}} | ConvertTo-Json", encoded);
        let result: serde_json::Value = super::powershell::run_script(probe.as_bytes()).unwrap();
        assert_eq!(result["parsed"], true);
    }
}

#[cfg(all(test, windows))]
mod live_tests;

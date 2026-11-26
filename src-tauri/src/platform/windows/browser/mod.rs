use super::mihomo_process;
use super::powershell;
use crate::{domain::nodes::NodeSummary, infrastructure::vault};
use serde_json::{json, Value};
use std::time::Duration;

pub(super) const DRIVER: &str = include_str!("browser.ps1");
pub(super) const WORKER: &str = include_str!("browser_worker.ps1");

pub(crate) fn guest_request(
    browser: &str,
    action: &str,
    node: &NodeSummary,
    locked: bool,
) -> Value {
    json!({"browser":browser,"action":action,"node":node,"runtimeLocked":locked,"script":DRIVER,"worker":WORKER})
}

pub(crate) fn run_native(
    browser: &str,
    action: &str,
    node: &NodeSummary,
    timezone: &super::runtime::TimezoneTarget,
    node_config: Value,
    locked: bool,
) -> Result<String, String> {
    let root = vault::dir()?;
    let request = json!({
        "root": root.join("Browser/native"),
        "browser": browser, "action": action, "runtimeLocked": locked,
        "nodeId": node.id, "nodeName": node.name, "exitIp": node.exit_ip,
        "timezoneTarget": timezone, "nodeConfig": node_config,
        "mihomo": mihomo_process::binary_path(&root.join("mihomo")), "worker": WORKER,
    });
    let result: Value = powershell::request(DRIVER, &request, Duration::from_secs(720))?;
    Ok(result.to_string())
}

#[cfg(all(test, windows))]
mod tests;

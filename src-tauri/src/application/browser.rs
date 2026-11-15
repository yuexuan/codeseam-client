use crate::infrastructure::{vault, windows};
use base64::{engine::general_purpose::STANDARD, Engine};

pub fn prepare(virtual_runtime: bool, browser: String) -> Result<String, String> {
    if !["", "edge", "chrome"].contains(&browser.as_str()) {
        return Err("不支持的浏览器".into());
    }
    if virtual_runtime {
        let snapshot = super::nodes::read()?;
        let node = snapshot
            .nodes
            .into_iter()
            .find(|n| {
                Some(&n.id) == snapshot.selected_id.as_ref()
                    && n.status == "connected"
                    && n.exit_ip.is_some()
            })
            .ok_or("请先选择并测试当前节点")?;
        return super::virtual_runtime::execute("browser_prepare".into(), serde_json::json!({"browser":browser,"script":include_str!("../infrastructure/browser.ps1"),"node":node}).to_string());
    }
    let runtime = super::runtime::read()?;
    if !runtime.confirmed {
        return Err("请先在第四步确认当前运行环境".into());
    }
    let request = serde_json::json!({"root": vault::dir()?.join("Browser").join("native"), "browser": browser, "nodeId": runtime.node.id, "nodeName": runtime.node.name});
    let script = format!("$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}')) | ConvertFrom-Json\n{}", STANDARD.encode(request.to_string()), include_str!("../infrastructure/browser.ps1"));
    let result: serde_json::Value = windows::run_script(script.as_bytes())?;
    Ok(result.to_string())
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    #[ignore = "Uses the current user's initialized Guest and creates/reuses its managed Profile"]
    fn guest_browser_prepare_live() {
        let first: serde_json::Value =
            serde_json::from_str(&super::prepare(true, String::new()).unwrap()).unwrap();
        assert_eq!(first["profile"]["runtime"], "Virtual");
        let second: serde_json::Value =
            serde_json::from_str(&super::prepare(true, String::new()).unwrap()).unwrap();
        assert_eq!(second["reused"], true);
        assert_eq!(
            first["profile"]["profilePath"],
            second["profile"]["profilePath"]
        );
        assert_eq!(
            first["profile"]["createdAt"],
            second["profile"]["createdAt"]
        );
        println!(
            "Guest browser creation/reuse passed: {}",
            second["profile"]["profileId"]
        );
    }
}

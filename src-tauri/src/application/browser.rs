use crate::infrastructure::{vault, windows};
use base64::{engine::general_purpose::STANDARD, Engine};

pub fn prepare(virtual_runtime: bool, browser: String) -> Result<String, String> {
    execute(virtual_runtime, browser, "prepare".into())
}

pub fn execute(virtual_runtime: bool, browser: String, action: String) -> Result<String, String> {
    if !["prepare", "open", "inspect", "confirm", "install_code", "install_desktop", "verify", "recreate"].contains(&action.as_str()) {
        return Err("未知浏览器操作".into());
    }
    if !["", "edge", "chrome"].contains(&browser.as_str()) {
        return Err("不支持的浏览器".into());
    }
    let runtime_locked = super::workbench::load()?.is_some_and(|record| record["reconfiguration"].is_object() || record["nodeRepair"].is_object() || record["virtualRuntime"] != virtual_runtime);
    if runtime_locked && ["open", "install_code", "install_desktop"].contains(&action.as_str()) {
        return Err("该运行环境尚未成为正式 Runtime，请完成或取消重新配置后再打开 Claude".into());
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
        return super::virtual_runtime::execute("browser_prepare".into(), serde_json::json!({"browser":browser,"action":action,"script":include_str!("../infrastructure/browser.ps1"),"worker":include_str!("../infrastructure/browser_worker.ps1"),"node":node,"runtimeLocked":runtime_locked}).to_string());
    }
    let runtime = super::runtime::read()?;
    if !runtime.confirmed {
        return Err("请先在第四步确认当前运行环境".into());
    }
    let timezone = super::runtime::timezone_target(&runtime.node)
        .ok_or("无法确定所选出口的目标时区，请返回第二步重新测试节点")?;
    let config = super::nodes::virtual_node_config()?;
    // 复用捆绑引擎的提供商验证和二进制提取逻辑。
    let engine = crate::infrastructure::mihomo::Engine::start(&[config.clone()])?;
    engine.node(0)?;
    drop(engine);
    let request = serde_json::json!({"root": vault::dir()?.join("Browser").join("native"), "browser": browser, "action":action, "nodeId": runtime.node.id, "nodeName": runtime.node.name, "exitIp":runtime.node.exit_ip,"timezoneTarget":timezone,"nodeConfig":config,"mihomo":vault::dir()?.join("mihomo/mihomo-v1.19.34.exe"),"worker":include_str!("../infrastructure/browser_worker.ps1"),"runtimeLocked":runtime_locked});
    let script = format!("$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}')) | ConvertFrom-Json\n{}", STANDARD.encode(request.to_string()), include_str!("../infrastructure/browser.ps1"));
    let result: serde_json::Value =
        windows::run_script_with_timeout(script.as_bytes(), std::time::Duration::from_secs(720))?;
    Ok(result.to_string())
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    #[ignore = "Closes the managed Guest browser and verifies initialization resumes, preserving its Profile"]
    fn guest_browser_reprepare_live() {
        let first: serde_json::Value = serde_json::from_str(&super::prepare(true, String::new()).unwrap()).unwrap();
        assert_eq!(first["profile"]["verificationStatus"], "satisfied", "{first}");
        let opened: serde_json::Value = serde_json::from_str(&super::execute(true, String::new(), "inspect".into()).unwrap()).unwrap();
        assert_eq!(opened["opened"], true, "{opened}");
        let second: serde_json::Value = serde_json::from_str(&super::prepare(true, String::new()).unwrap()).unwrap();
        assert_eq!(second["profile"]["verificationStatus"], "satisfied", "{second}");
        assert_eq!(second["profile"]["baselineStatus"], "satisfied", "{second}");
        assert_eq!(second["reused"], true);
        assert_eq!(second["profile"]["profilePath"], first["profile"]["profilePath"]);
        assert_eq!(second["profile"]["createdAt"], first["profile"]["createdAt"]);
        println!("Managed Guest browser closed and initialization resumed through a measured baseline; Profile preserved");
    }
    #[test]
    #[ignore = "Uses the current user's initialized Guest and creates/reuses its managed Profile"]
    fn guest_browser_prepare_live() {
        let first: serde_json::Value =
            serde_json::from_str(&super::prepare(true, String::new()).unwrap()).unwrap();
        assert_eq!(first["profile"]["runtime"], "Virtual");
        assert_eq!(
            first["profile"]["verificationStatus"], "satisfied",
            "{first}"
        );
        assert_eq!(first["profile"]["baselineStatus"], "satisfied", "{first}");
        let second: serde_json::Value =
            serde_json::from_str(&super::prepare(true, String::new()).unwrap()).unwrap();
        assert_eq!(second["reused"], true);
        assert_eq!(
            second["profile"]["verificationStatus"], "satisfied",
            "{second}"
        );
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

    #[test]
    #[ignore = "Reverifies and confirms the user's existing Guest browser baseline"]
    fn guest_browser_confirm_live() {
        let result: serde_json::Value =
            serde_json::from_str(&super::execute(true, String::new(), "confirm".into()).unwrap())
                .unwrap();
        assert_eq!(result["profile"]["confirmed"], true, "{result}");
        assert_eq!(
            result["profile"]["verificationStatus"], "satisfied",
            "{result}"
        );
        println!(
            "Confirmed Guest browser baseline: {}",
            result["profile"]["baselinePath"]
        );
    }

    #[test]
    #[ignore = "Opens the managed Guest browser, checks it survives the controller and closes only that test window"]
    fn guest_browser_open_live() {
        let result: serde_json::Value =
            serde_json::from_str(&super::execute(true, String::new(), "open".into()).unwrap())
                .unwrap();
        assert_eq!(result["opened"], true, "{result}");
        let browser_pid = result["browserProcessId"].as_u64().unwrap();
        let probe = format!(
            r#"$ErrorActionPreference='Stop'
    $browserId={browser_pid}
    $p=Get-CimInstance Win32_Process -Filter ("ProcessId=" + $browserId)
    if (!$p -or $p.Name -ne 'msedge.exe' -or !$p.CommandLine.Contains('CodeSeam\Browser\edge\User Data')) {{ throw 'Managed test browser did not survive controller' }}
    if ($p.CommandLine.Contains('--remote-debugging-port')) {{ throw 'Debugging must not remain enabled for normal use' }}
    Stop-Process -Id $browserId -Force -ErrorAction Stop
    @{{survived=$true;closedTestWindow=$true}} | ConvertTo-Json -Compress"#
        );
        let snapshot = crate::application::nodes::read().unwrap();
        let node = snapshot
            .nodes
            .into_iter()
            .find(|n| Some(&n.id) == snapshot.selected_id.as_ref())
            .unwrap();
        let observed: serde_json::Value = serde_json::from_str(
            &crate::application::virtual_runtime::execute(
                "browser_prepare".into(),
                serde_json::json!({"node":node,"script":probe}).to_string(),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(observed["survived"], true);
        println!("Guest managed launcher survives controller; no debug port; test window closed");
    }

    #[test]
    #[ignore = "Probes a separate native browser profile using the real selected node, without changing host settings"]
    fn native_browser_probe_live() {
        use base64::Engine;
        let snapshot = crate::application::nodes::read().unwrap();
        let node = snapshot
            .nodes
            .into_iter()
            .find(|n| Some(&n.id) == snapshot.selected_id.as_ref())
            .unwrap();
        let config = crate::application::nodes::virtual_node_config().unwrap();
        let engine = crate::infrastructure::mihomo::Engine::start(&[config.clone()]).unwrap();
        engine.node(0).unwrap();
        drop(engine);
        let root = crate::infrastructure::vault::dir().unwrap();
        let timezone = crate::application::runtime::timezone_target(&node).unwrap();
        let mut request = serde_json::json!({"root":root.join("Browser/native-live-probe"),"action":"prepare","browser":"edge","nodeId":node.id,"nodeName":node.name,"exitIp":node.exit_ip,"timezoneTarget":timezone,"nodeConfig":config,"mihomo":root.join("mihomo/mihomo-v1.19.34.exe"),"desktopPath":root.join("Browser/native-live-probe/Shortcuts"),"worker":include_str!("../infrastructure/browser_worker.ps1")});
        let script = format!("$request=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}')) | ConvertFrom-Json\n{}", base64::engine::general_purpose::STANDARD.encode(request.to_string()), include_str!("../infrastructure/browser.ps1"));
        let result: serde_json::Value = crate::infrastructure::windows::run_script_with_timeout(
            script.as_bytes(),
            std::time::Duration::from_secs(240),
        )
        .unwrap();
        assert_eq!(
            result["profile"]["verificationStatus"], "satisfied",
            "{result}"
        );
        assert_eq!(result["profile"]["baselineStatus"], "satisfied", "{result}");
        request["action"] = "open".into();
        let script = format!("$request=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}')) | ConvertFrom-Json\n{}", base64::engine::general_purpose::STANDARD.encode(request.to_string()), include_str!("../infrastructure/browser.ps1"));
        let opened: serde_json::Value =
            crate::infrastructure::windows::run_script(script.as_bytes()).unwrap();
        assert_eq!(opened["opened"], true, "{opened}");
        let browser_pid = opened["browserProcessId"].as_u64().unwrap();
        let probe = format!(
            r#"$ErrorActionPreference='Stop'
$p=Get-CimInstance Win32_Process -Filter 'ProcessId={browser_pid}'
if (!$p -or !$p.CommandLine.Contains('native-live-probe') -or $p.CommandLine.Contains('--remote-debugging-port')) {{ throw 'Native browser did not survive the detection job with debugging disabled' }}
Stop-Process -Id {browser_pid} -Force -ErrorAction Stop
@{{survived=$true}} | ConvertTo-Json -Compress"#
        );
        let survived: serde_json::Value =
            crate::infrastructure::windows::run_script(probe.as_bytes()).unwrap();
        assert_eq!(survived["survived"], true);
        println!(
            "Native isolated browser probe passed: {}",
            result["profile"]["verification"]["exitIp"]
        );
    }
}

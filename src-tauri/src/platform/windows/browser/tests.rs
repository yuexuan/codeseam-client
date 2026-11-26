use super::super::powershell;
use crate::application::browser::{execute, prepare};

#[test]
#[ignore = "Closes the managed Guest browser and verifies initialization resumes, preserving its Profile"]
fn guest_browser_reprepare_live() {
    let first: serde_json::Value =
        serde_json::from_str(&prepare(true, String::new()).unwrap()).unwrap();
    assert_eq!(
        first["profile"]["verificationStatus"], "satisfied",
        "{first}"
    );
    let opened: serde_json::Value =
        serde_json::from_str(&execute(true, String::new(), "inspect".into()).unwrap()).unwrap();
    assert_eq!(opened["opened"], true, "{opened}");
    let second: serde_json::Value =
        serde_json::from_str(&prepare(true, String::new()).unwrap()).unwrap();
    assert_eq!(
        second["profile"]["verificationStatus"], "satisfied",
        "{second}"
    );
    assert_eq!(second["profile"]["baselineStatus"], "satisfied", "{second}");
    assert_eq!(second["reused"], true);
    assert_eq!(
        second["profile"]["profilePath"],
        first["profile"]["profilePath"]
    );
    assert_eq!(
        second["profile"]["createdAt"],
        first["profile"]["createdAt"]
    );
    println!("Managed Guest browser closed and initialization resumed through a measured baseline; Profile preserved");
}
#[test]
#[ignore = "Uses the current user's initialized Guest and creates/reuses its managed Profile"]
fn guest_browser_prepare_live() {
    let first: serde_json::Value =
        serde_json::from_str(&prepare(true, String::new()).unwrap()).unwrap();
    assert_eq!(first["profile"]["runtime"], "Virtual");
    assert_eq!(
        first["profile"]["verificationStatus"], "satisfied",
        "{first}"
    );
    assert_eq!(first["profile"]["baselineStatus"], "satisfied", "{first}");
    let second: serde_json::Value =
        serde_json::from_str(&prepare(true, String::new()).unwrap()).unwrap();
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
        serde_json::from_str(&execute(true, String::new(), "confirm".into()).unwrap()).unwrap();
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
        serde_json::from_str(&execute(true, String::new(), "open".into()).unwrap()).unwrap();
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
        &crate::application::runtime::virtual_runtime::execute(
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
    let mut request = serde_json::json!({"root":root.join("Browser/native-live-probe"),"action":"prepare","browser":"edge","nodeId":node.id,"nodeName":node.name,"exitIp":node.exit_ip,"timezoneTarget":timezone,"nodeConfig":config,"mihomo":super::mihomo_process::binary_path(&root.join("mihomo")),"desktopPath":root.join("Browser/native-live-probe/Shortcuts"),"worker":super::WORKER});
    let script = format!("$request=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}')) | ConvertFrom-Json\n{}", base64::engine::general_purpose::STANDARD.encode(request.to_string()), super::DRIVER);
    let result: serde_json::Value =
        powershell::run_script_with_timeout(script.as_bytes(), std::time::Duration::from_secs(240))
            .unwrap();
    assert_eq!(
        result["profile"]["verificationStatus"], "satisfied",
        "{result}"
    );
    assert_eq!(result["profile"]["baselineStatus"], "satisfied", "{result}");
    request["action"] = "open".into();
    let script = format!("$request=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}')) | ConvertFrom-Json\n{}", base64::engine::general_purpose::STANDARD.encode(request.to_string()), super::DRIVER);
    let opened: serde_json::Value = powershell::run_script(script.as_bytes()).unwrap();
    assert_eq!(opened["opened"], true, "{opened}");
    let browser_pid = opened["browserProcessId"].as_u64().unwrap();
    let probe = format!(
        r#"$ErrorActionPreference='Stop'
$p=Get-CimInstance Win32_Process -Filter 'ProcessId={browser_pid}'
if (!$p -or !$p.CommandLine.Contains('native-live-probe') -or $p.CommandLine.Contains('--remote-debugging-port')) {{ throw 'Native browser did not survive the detection job with debugging disabled' }}
Stop-Process -Id {browser_pid} -Force -ErrorAction Stop
@{{survived=$true}} | ConvertTo-Json -Compress"#
    );
    let survived: serde_json::Value = powershell::run_script(probe.as_bytes()).unwrap();
    assert_eq!(survived["survived"], true);
    println!(
        "Native isolated browser probe passed: {}",
        result["profile"]["verification"]["exitIp"]
    );
}

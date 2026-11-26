use super::powershell;
use crate::application::runtime::virtual_runtime::execute;

#[test]
#[ignore = "Synchronizes the initialized Guest timezone with the selected exit and reads its real browser timezone in an isolated profile"]
fn guest_timezone_sync_live() {
    let ready: serde_json::Value =
        serde_json::from_str(&execute("ensure_ready".into(), "{}".into()).unwrap()).unwrap();
    assert_eq!(ready["ready"], true, "{ready}");
    assert_eq!(
        ready["timezone"], ready["timezoneTarget"]["windowsId"],
        "{ready}"
    );
    let script = include_str!("../../../../../tests/fixtures/browser-timezone-probe.ps1");
    let observed: serde_json::Value = serde_json::from_str(
        &execute(
            "browser_prepare".into(),
            serde_json::json!({"script":script}).to_string(),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        observed["timezone"], ready["timezoneTarget"]["ianaId"],
        "{observed}"
    );
    println!("Guest system and browser timezone match selected exit: {observed}");
}
#[test]
#[ignore = "Opens/restores the existing formal Guest console twice and checks it survives the controller job"]
fn daily_guest_console_reuse_live() {
    let checkpoint: serde_json::Value = serde_json::from_str(
        std::fs::read_to_string(
            crate::infrastructure::vault::dir()
                .unwrap()
                .join("Virtual/checkpoint.json"),
        )
        .unwrap()
        .trim_start_matches('\u{feff}'),
    )
    .unwrap();
    let payload = serde_json::json!({"profile":{"runtimeId":checkpoint["vmId"]}}).to_string();
    let open = || -> serde_json::Value {
        serde_json::from_str(&execute("open_console".into(), payload.clone()).unwrap()).unwrap()
    };
    let first = open();
    let second = open();
    assert_eq!(first["opened"], true);
    assert_eq!(second["opened"], true);
    assert_eq!(
        first["processId"], second["processId"],
        "must restore/reuse the same console"
    );
    let process_id = second["processId"].as_u64().unwrap();
    let probe = format!("@{{alive=($null -ne (Get-Process -Id {process_id} -ErrorAction SilentlyContinue))}} | ConvertTo-Json -Compress");
    let alive: serde_json::Value = powershell::run_script(probe.as_bytes()).unwrap();
    assert_eq!(alive["alive"], true);
    println!("formal Guest console restored/reused and alive after controller exit: {second}");
}

#[test]
#[ignore = "Checks the current user's existing Guest and opens/reuses its VM console"]
fn guest_console_ready_live() {
    let started = std::time::Instant::now();
    let result: serde_json::Value = serde_json::from_str(
        &execute("ensure_ready".into(), r#"{"openConsole":true}"#.into()).unwrap(),
    )
    .unwrap();
    assert_eq!(result["ready"], true);
    assert_eq!(result["consoleOpened"], true);
    let process_id = result["consoleProcessId"].as_u64().unwrap();
    // execute() 返回时，其管理的进程作业也已关闭。
    let probe = format!("@{{alive=($null -ne (Get-Process -Id {process_id} -ErrorAction SilentlyContinue))}} | ConvertTo-Json -Compress");
    let alive: serde_json::Value = powershell::run_script(probe.as_bytes()).unwrap();
    assert_eq!(alive["alive"], true);
    assert!(started.elapsed().as_secs() < 180);
    println!(
        "{}; elapsed={:?}; console survives controller job",
        result,
        started.elapsed()
    );
}

#[test]
#[ignore = "Starts the user's previously created candidate VM unattended installation"]
fn virtual_runtime_auto_install_native() {
    println!("{}", execute("initialize".into(), "{}".into()).unwrap());
}

use crate::infrastructure::{vault, windows};
use base64::{engine::general_purpose::STANDARD, Engine};

fn controller_script() -> String {
    // 文件 BOM 只允许出现在开头，不能插入到文件中间。
    include_str!("../infrastructure/virtual_runtime.ps1")
        .trim_start_matches('\u{feff}')
        .replace("# GUEST_FUNCTIONS", include_str!("../infrastructure/guest_install.ps1").trim_start_matches('\u{feff}'))
        .replace("# GUEST_BROWSER", include_str!("../infrastructure/guest_browser.ps1").trim_start_matches('\u{feff}'))
        .replace("# DAILY_RUNTIME", include_str!("../infrastructure/daily_virtual_runtime.ps1"))
        .replace("# NODE_REPAIR", include_str!("../infrastructure/node_repair.ps1"))
        .replace("# CONSOLE_DISPLAY", include_str!("../infrastructure/console_display.ps1"))
}

pub fn execute(action: String, payload: String) -> Result<String, String> {
    if action == "status" {
        let path = vault::dir()?.join("Virtual").join("guest-progress.json");
        return match std::fs::read_to_string(path) {
            Ok(data) => { serde_json::from_str::<serde_json::Value>(&data.trim_start_matches('\u{feff}')).map_err(|e| e.to_string())?; Ok(data.trim_start_matches('\u{feff}').to_owned()) },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({"name":"", "state":"Preparing", "ready":false,"progress":0,"detail":"正在准备自动初始化任务"}).to_string()),
            Err(e) => Err(e.to_string()),
        };
    }
    if action == "image_status" {
        return Ok(crate::infrastructure::installation_image::status().to_string());
    }
    if action == "prepare_image" {
        let input: serde_json::Value = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
        let path = crate::infrastructure::installation_image::prepare(
            input["iso"].as_str().ok_or("缺少安装镜像地址")?,
            &vault::dir()?.join("Virtual").join("Images"),
        )?;
        return Ok(serde_json::json!({"path": path}).to_string());
    }
    if ![
        "read",
        "enable",
        "create",
        "status",
        "restart",
        "initialize",
        "browser_prepare",
        "ensure_ready",
        "observe",
        "start",
        "open_console",
        "pause_apps",
        "unlock_apps",
        "repair_node",
    ]
    .contains(&action.as_str())
    {
        return Err("未知虚拟机操作".into());
    }
    let mut input: serde_json::Value = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
    let node = if ["create", "initialize", "ensure_ready", "browser_prepare", "repair_node"].contains(&action.as_str()) {
        let snapshot = super::nodes::read()?;
        Some(
            snapshot
                .nodes
                .into_iter()
                .find(|n| {
                    Some(&n.id) == snapshot.selected_id.as_ref()
                        && n.status == "connected"
                        && n.exit_ip.is_some()
                })
                .ok_or("请先选择并测试节点")?,
        )
    } else {
        None
    };
    if ["initialize", "ensure_ready", "browser_prepare", "repair_node"].contains(&action.as_str()) {
        let selected = node.as_ref().ok_or("请先选择并测试节点")?;
        let timezone = super::runtime::timezone_target(selected)
            .ok_or("无法确定所选出口的目标时区，请返回第二步重新测试节点")?;
        input["node"] = serde_json::to_value(selected).map_err(|e| e.to_string())?;
        input["timezoneTarget"] = serde_json::to_value(timezone).map_err(|e| e.to_string())?;
    }
    if action == "initialize" {
        vault::save("virtual-node-v1.dpapi", &serde_json::to_vec(&super::nodes::virtual_node_config()?).map_err(|e| e.to_string())?)?;
    }
    if action == "repair_node" { input["nodeConfig"] = super::nodes::virtual_node_config()?; }
    let timeout_seconds = if action == "browser_prepare" { 900 } else { 600 };
    let request = serde_json::json!({"action": action, "config": input, "root": vault::dir()?.join("Virtual"), "node": node});
    let script = format!("$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}')) | ConvertFrom-Json\n{}", STANDARD.encode(request.to_string()), controller_script());
    let result: serde_json::Value =
        windows::run_script_with_timeout(script.as_bytes(), std::time::Duration::from_secs(timeout_seconds))?;
    if action == "repair_node" { vault::save("virtual-node-v1.dpapi", &serde_json::to_vec(&super::nodes::virtual_node_config()?).map_err(|e| e.to_string())?)?; }
    Ok(result.to_string())
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    #[ignore = "Synchronizes the initialized Guest timezone with the selected exit and reads its real browser timezone in an isolated profile"]
    fn guest_timezone_sync_live() {
        let ready: serde_json::Value = serde_json::from_str(&super::execute("ensure_ready".into(), "{}".into()).unwrap()).unwrap();
        assert_eq!(ready["ready"], true, "{ready}");
        assert_eq!(ready["timezone"], ready["timezoneTarget"]["windowsId"], "{ready}");
        let script = include_str!("../../../tests/fixtures/browser-timezone-probe.ps1");
        let observed: serde_json::Value = serde_json::from_str(&super::execute("browser_prepare".into(), serde_json::json!({"script":script}).to_string()).unwrap()).unwrap();
        assert_eq!(observed["timezone"], ready["timezoneTarget"]["ianaId"], "{observed}");
        println!("Guest system and browser timezone match selected exit: {observed}");
    }
    #[test]
    fn assembled_controller_parses_without_running_system_operations() {
        use base64::Engine;
        let script = super::controller_script();
        assert!(!script.contains('\u{feff}'));
        let encoded = base64::engine::general_purpose::STANDARD.encode(script.as_bytes());
        let probe = format!("$s = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}')); $null = [ScriptBlock]::Create($s); @{{parsed=$true}} | ConvertTo-Json", encoded);
        let result: serde_json::Value = crate::infrastructure::windows::run_script(probe.as_bytes()).unwrap();
        assert_eq!(result["parsed"], true);
    }

    #[test]
    #[ignore = "Opens/restores the existing formal Guest console twice and checks it survives the controller job"]
    fn daily_guest_console_reuse_live() {
        let checkpoint: serde_json::Value = serde_json::from_str(
            std::fs::read_to_string(crate::infrastructure::vault::dir().unwrap().join("Virtual/checkpoint.json"))
                .unwrap().trim_start_matches('\u{feff}'),
        ).unwrap();
        let payload = serde_json::json!({"profile":{"runtimeId":checkpoint["vmId"]}}).to_string();
        let open = || -> serde_json::Value {
            serde_json::from_str(&super::execute("open_console".into(), payload.clone()).unwrap()).unwrap()
        };
        let first = open();
        let second = open();
        assert_eq!(first["opened"], true);
        assert_eq!(second["opened"], true);
        assert_eq!(first["processId"], second["processId"], "must restore/reuse the same console");
        let process_id = second["processId"].as_u64().unwrap();
        let probe = format!("@{{alive=($null -ne (Get-Process -Id {process_id} -ErrorAction SilentlyContinue))}} | ConvertTo-Json -Compress");
        let alive: serde_json::Value = crate::infrastructure::windows::run_script(probe.as_bytes()).unwrap();
        assert_eq!(alive["alive"], true);
        println!("formal Guest console restored/reused and alive after controller exit: {second}");
    }

    #[test]
    #[ignore = "Checks the current user's existing Guest and opens/reuses its VM console"]
    fn guest_console_ready_live() {
        let started = std::time::Instant::now();
        let result: serde_json::Value = serde_json::from_str(
            &super::execute("ensure_ready".into(), r#"{"openConsole":true}"#.into()).unwrap(),
        )
        .unwrap();
        assert_eq!(result["ready"], true);
        assert_eq!(result["consoleOpened"], true);
        let process_id = result["consoleProcessId"].as_u64().unwrap();
        // execute() 返回时，其管理的进程作业也已关闭。
        let probe = format!("@{{alive=($null -ne (Get-Process -Id {process_id} -ErrorAction SilentlyContinue))}} | ConvertTo-Json -Compress");
        let alive: serde_json::Value =
            crate::infrastructure::windows::run_script(probe.as_bytes()).unwrap();
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
        println!(
            "{}",
            super::execute("initialize".into(), "{}".into()).unwrap()
        );
    }
}

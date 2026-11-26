use crate::application::{nodes, runtime};
use crate::infrastructure::vault;

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
        "stop",
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
    let node = if [
        "create",
        "initialize",
        "ensure_ready",
        "browser_prepare",
        "repair_node",
    ]
    .contains(&action.as_str())
    {
        let snapshot = nodes::read()?;
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
    if [
        "initialize",
        "ensure_ready",
        "browser_prepare",
        "repair_node",
    ]
    .contains(&action.as_str())
    {
        let selected = node.as_ref().ok_or("请先选择并测试节点")?;
        let timezone = runtime::timezone_target(selected)
            .ok_or("无法确定所选出口的目标时区，请返回第二步重新测试节点")?;
        input["node"] = serde_json::to_value(selected).map_err(|e| e.to_string())?;
        input["timezoneTarget"] = serde_json::to_value(timezone).map_err(|e| e.to_string())?;
    }
    if action == "initialize" {
        vault::save(
            "virtual-node-v1.dpapi",
            &serde_json::to_vec(&nodes::virtual_node_config()?).map_err(|e| e.to_string())?,
        )?;
    }
    if action == "repair_node" {
        input["nodeConfig"] = nodes::virtual_node_config()?;
    }
    let result = crate::platform::hyperv::run(&action, input, node)?;
    if action == "repair_node" {
        vault::save(
            "virtual-node-v1.dpapi",
            &serde_json::to_vec(&nodes::virtual_node_config()?).map_err(|e| e.to_string())?,
        )?;
    }
    Ok(result.to_string())
}

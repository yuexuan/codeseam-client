//! 独立于初始化向导的节点维护流程。
use crate::application::{browser, nodes, runtime, runtime::management};
use crate::infrastructure::vault;
use serde_json::{json, Value};

pub fn validate_switch(
    record: &Value,
    snapshot: &crate::domain::nodes::NodeSnapshot,
    id: &str,
) -> Result<(), String> {
    let baseline_id = record["baseline"]["profile"]["nodeId"].as_str();
    let baseline = snapshot
        .nodes
        .iter()
        .find(|node| Some(node.id.as_str()) == baseline_id);
    let country = record["nodeCountry"]["code"]
        .as_str()
        .or_else(|| record["runtime"]["node"]["countryCode"].as_str())
        .or_else(|| baseline.and_then(|node| node.country_code.as_deref()))
        .filter(|code| !code.is_empty())
        .ok_or("当前环境出口国家待确认，请先完成节点检测")?;
    let target = snapshot
        .nodes
        .iter()
        .find(|node| node.id == id)
        .ok_or("节点已不存在，请刷新后重试")?;
    if snapshot
        .nodes
        .iter()
        .any(|node| matches!(node.status.as_str(), "testing" | "queued"))
    {
        return Err("请等待节点测试完成后再切换".into());
    }
    if target.status != "connected"
        || target
            .exit_ip
            .as_deref()
            .and_then(|ip| ip.parse::<std::net::IpAddr>().ok())
            .is_none()
    {
        return Err("请先完成目标节点的真实出口测试".into());
    }
    if !target
        .country_code
        .as_deref()
        .is_some_and(|code| code.eq_ignore_ascii_case(country))
    {
        return Err("仅可选择与当前环境出口国家一致的节点".into());
    }
    Ok(())
}

pub fn backup(record: &mut Value) -> Result<(), String> {
    if record["reconfiguration"].is_object() {
        return Err("请先完成或取消运行环境切换".into());
    }
    if record["nodeRepair"].is_object() {
        return Ok(());
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos()
        .to_string();
    let backup = format!("RuntimeHistory/node-{stamp}");
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
    record["nodeRepair"] = json!({"backup": backup});
    Ok(())
}

pub fn apply(record: &Value) -> Result<(Value, Value), String> {
    let snapshot = nodes::read()?;
    let node = snapshot
        .nodes
        .iter()
        .find(|node| {
            Some(&node.id) == snapshot.selected_id.as_ref()
                && node.status == "connected"
                && node.exit_ip.is_some()
        })
        .ok_or("请选择节点并完成连接测试")?;
    if snapshot
        .nodes
        .iter()
        .any(|node| matches!(node.status.as_str(), "testing" | "queued"))
    {
        return Err("请等待节点测试完成后再应用".into());
    }
    let virtual_runtime = record["virtualRuntime"] == true;
    management::observe(record, "pause_apps")?;
    let runtime = if virtual_runtime {
        runtime::virtual_runtime::execute(
            "repair_node".into(),
            json!({"profile": record["baseline"]["profile"]}).to_string(),
        )?;
        Value::Null
    } else {
        let report = runtime::read()?;
        if !report.ready {
            let issues = report
                .checks
                .iter()
                .filter(|check| check.blocking)
                .map(|check| format!("{}：{}", check.label, check.value))
                .collect::<Vec<_>>()
                .join("；");
            return Err(format!("本机环境与新节点不匹配，请处理后重试：{issues}"));
        }
        serde_json::to_value(runtime::confirm(report.revision)?).map_err(|e| e.to_string())?
    };
    let browser = record["baseline"]["profile"]["browserId"]
        .as_str()
        .ok_or("浏览器记录无效")?;
    browser::prepare(virtual_runtime, browser.into())?;
    let baseline: Value = serde_json::from_str(&browser::execute(
        virtual_runtime,
        browser.into(),
        "confirm".into(),
    )?)
    .map_err(|e| e.to_string())?;
    if baseline["profile"]["nodeId"] != node.id
        || baseline["profile"]["verification"]["exitIp"].as_str() != node.exit_ip.as_deref()
    {
        return Err("应用期间节点或出口已变化，请重新测试后重试".into());
    }
    Ok((baseline, runtime))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn daily_switch_requires_a_verified_same_country_exit() {
        use crate::domain::nodes::{NodeSnapshot, NodeSummary, ProxyRuntime};
        let node = |id: &str, country: Option<&str>| NodeSummary {
            id: id.into(),
            name: id.into(),
            protocol: "socks5".into(),
            region: None,
            country_code: country.map(str::to_string),
            latency: Some(68),
            exit_ip: Some("192.0.2.1".into()),
            status: "connected".into(),
            error: None,
        };
        let mut snapshot = NodeSnapshot {
            nodes: vec![
                node("base", Some("sg")),
                node("same", Some("SG")),
                node("foreign", Some("us")),
                node("unknown", None),
            ],
            selected_id: Some("base".into()),
            runtime: ProxyRuntime {
                running: Some(false),
                version: None,
            },
        };
        let record = json!({"baseline":{"profile":{"nodeId":"base"}}});
        assert!(validate_switch(&record, &snapshot, "same").is_ok());
        assert!(validate_switch(&record, &snapshot, "foreign")
            .unwrap_err()
            .contains("国家"));
        assert!(validate_switch(&record, &snapshot, "unknown").is_err());
        assert!(validate_switch(&record, &snapshot, "missing").is_err());
        snapshot.nodes[1].exit_ip = Some("invalid".into());
        assert!(validate_switch(&record, &snapshot, "same").is_err());
        snapshot.nodes[1].exit_ip = Some("192.0.2.1".into());
        snapshot.nodes[0].status = "testing".into();
        assert!(validate_switch(&record, &snapshot, "same")
            .unwrap_err()
            .contains("等待"));
        snapshot.nodes[0].status = "failed".into();
        snapshot.nodes[0].country_code = None;
        assert!(validate_switch(&record, &snapshot, "same").is_err());
        let persisted =
            json!({"nodeCountry":{"code":"sg"}, "baseline":{"profile":{"nodeId":"base"}}});
        assert!(validate_switch(&persisted, &snapshot, "same").is_ok());
    }
    #[test]
    fn repair_backup_survives_failure_and_retry_without_replacing_the_baseline() {
        let _guard = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
        let directory =
            std::env::temp_dir().join(format!("codeseam-node-repair-{}", std::process::id()));
        let previous = std::env::var_os("CODESEAM_TEST_DATA_DIR");
        std::env::set_var("CODESEAM_TEST_DATA_DIR", &directory);
        let outcome = std::panic::catch_unwind(|| {
            vault::save("workbench-v1.dpapi", b"original baseline").unwrap();
            vault::save("virtual-node-v1.dpapi", b"original provider").unwrap();
            let mut record =
                json!({"baseline":{"profile":{"profileId":"keep"}},"virtualRuntime":true});
            backup(&mut record).unwrap();
            let checkpoint = record["nodeRepair"].clone();
            let path = checkpoint["backup"].as_str().unwrap();
            assert_eq!(
                vault::read(&format!("{path}/workbench-v1.dpapi"))
                    .unwrap()
                    .unwrap(),
                b"original baseline"
            );
            assert_eq!(
                vault::read(&format!("{path}/virtual-node-v1.dpapi"))
                    .unwrap()
                    .unwrap(),
                b"original provider"
            );
            assert!(apply(&record).unwrap_err().contains("测试"));
            backup(&mut record).unwrap();
            assert_eq!(record["nodeRepair"], checkpoint);
            assert_eq!(record["baseline"]["profile"]["profileId"], "keep");
            assert_eq!(
                vault::read("workbench-v1.dpapi").unwrap().unwrap(),
                b"original baseline"
            );
            let mut switching = json!({"reconfiguration":{"virtualRuntime":false}});
            assert!(backup(&mut switching).is_err());
        });
        match previous {
            Some(value) => std::env::set_var("CODESEAM_TEST_DATA_DIR", value),
            None => std::env::remove_var("CODESEAM_TEST_DATA_DIR"),
        }
        let resolved = directory.canonicalize().unwrap();
        assert!(resolved.starts_with(std::env::temp_dir().canonicalize().unwrap()));
        std::fs::remove_dir_all(resolved).unwrap();
        if let Err(error) = outcome {
            std::panic::resume_unwind(error);
        }
    }
}

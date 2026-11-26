use super::{event, now};
use crate::application::{browser, claude, guardian, nodes, runtime, runtime::management};
use crate::infrastructure::vault;
use serde_json::{json, Value};

pub(super) const RECORD: &str = "workbench-v1.dpapi";

pub(crate) fn load() -> Result<Option<Value>, String> {
    vault::read(RECORD)?
        .map(|bytes| {
            let v: Value =
                serde_json::from_slice(&bytes).map_err(|e| format!("正式基线记录损坏：{e}"))?;
            if v["schema"] != 1
                || !valid_profile(&v["baseline"]["profile"])
                || !v["events"].is_array()
                || !v["virtualRuntime"].is_boolean()
            {
                return Err("正式基线版本或结构无法识别，原记录已保留".into());
            }
            Ok(v)
        })
        .transpose()
}
pub(super) fn save(value: &Value) -> Result<(), String> {
    vault::save(
        RECORD,
        &serde_json::to_vec(value).map_err(|e| e.to_string())?,
    )
}
pub(super) fn valid_profile(p: &Value) -> bool {
    [
        "proxyStatus",
        "parametersStatus",
        "shortcutStatus",
        "verificationStatus",
        "baselineStatus",
        "timezoneStatus",
    ]
    .iter()
    .all(|k| p[k] == "satisfied")
        && p["confirmed"] == true
        && p["verification"]["ok"] == true
        && p["compatibility"]["status"] == "satisfied"
        && p["targetTimezone"].as_str().is_some_and(|s| !s.is_empty())
        && p["verification"]["observed"]["timezone"] == p["targetTimezone"]
        && p["verification"]["exitIp"]
            .as_str()
            .is_some_and(|s| s.parse::<std::net::IpAddr>().is_ok())
}
pub(super) fn validate_daily_browser(record: &Value) -> Result<(), String> {
    validate_browser_with_runtime(record, &Value::Null)
}
pub(super) fn validate_runtime_start(record: &Value) -> Result<(), String> {
    if record["reconfiguration"].is_object() {
        return Err("请先完成或取消运行环境重新配置".into());
    }
    Ok(())
}

pub(super) fn validate_browser_with_runtime(
    record: &Value,
    observed: &Value,
) -> Result<(), String> {
    if record["nodeRepair"].is_object() {
        return Err("节点修复尚未完成，请打开节点编辑并重新应用".into());
    }
    let p = &record["baseline"]["profile"];
    let snapshot = nodes::read()?;
    if !snapshot.nodes.iter().any(|n| {
        Some(&n.id) == snapshot.selected_id.as_ref()
            && p["nodeId"] == n.id
            && p["verification"]["exitIp"].as_str() == n.exit_ip.as_deref()
    }) {
        return Err("所选节点或出口已偏离正式基线，请先重新确认环境".into());
    }
    if record["virtualRuntime"] != true {
        let current = if observed.is_null() {
            serde_json::to_value(runtime::read()?).map_err(|e| e.to_string())?
        } else {
            observed.clone()
        };
        if current["confirmed"] != true || record["runtime"]["revision"] != current["revision"] {
            return Err("当前运行环境与正式基线不一致，请先重新确认环境".into());
        }
    } else {
        let vm: Value = serde_json::from_str(
            &std::fs::read_to_string(vault::dir()?.join("Virtual/checkpoint.json"))
                .map_err(|_| "无法读取正式虚拟环境记录")?
                .trim_start_matches('\u{feff}'),
        )
        .map_err(|_| "虚拟环境记录无效")?;
        if vm["vmId"] != p["runtimeId"] {
            return Err("当前虚拟环境与正式基线不一致".into());
        }
    }
    Ok(())
}

pub(super) fn confirm(input: &Value) -> Result<String, String> {
    let previous = load()?;
    let alias = input["alias"].as_str().unwrap_or("").trim();
    let region = input["region"].as_str().unwrap_or("").trim();
    if alias.chars().count() > 80 || region.chars().count() > 80 {
        return Err("账号备注最多 80 个字符".into());
    }
    let virtual_runtime =
        management::validate_confirmation(previous.as_ref(), input["virtualRuntime"].as_bool())?;
    let browser = input["browser"].as_str().ok_or("缺少浏览器")?.to_string();
    // 重新读取并验证可信的原生证据，不接受客户端传入的通过标记。
    let baseline: Value = serde_json::from_str(&browser::execute(
        virtual_runtime,
        browser,
        "confirm".into(),
    )?)
    .map_err(|e| e.to_string())?;
    if !valid_profile(&baseline["profile"]) {
        return Err("浏览器或出口复验未通过，尚未保存正式基线".into());
    }
    let runtime = if virtual_runtime {
        Value::Null
    } else {
        let report = runtime::read()?;
        if !report.ready
            || !report.confirmed
            || baseline["profile"]["nodeId"] != report.node.id
            || baseline["profile"]["verification"]["exitIp"].as_str()
                != report.node.exit_ip.as_deref()
        {
            return Err("运行环境已变化，请返回运行环境重新确认".into());
        }
        serde_json::to_value(report).map_err(|e| e.to_string())?
    };
    let cleanup = serde_json::to_value(claude::read()?).map_err(|e| e.to_string())?;
    let mut record = json!({"schema":1,"confirmedAt":now(),"alias":alias,"region":region,"virtualRuntime":virtual_runtime,"baseline":baseline,"runtime":runtime,"cleanup":cleanup,"observation":null,"events":[]});
    let snapshot = nodes::read()?;
    if let Some(node) = snapshot
        .nodes
        .iter()
        .find(|node| record["baseline"]["profile"]["nodeId"] == node.id)
    {
        record["nodeCountry"] = json!({"code": node.country_code, "region": node.region});
    }
    record["baselineVersion"] = json!(previous
        .as_ref()
        .map(|old| old["baselineVersion"].as_u64().unwrap_or(1) + 1)
        .unwrap_or(1));
    event(&mut record, "用户确认初始化，正式环境基线已保存", "success");
    event(
        &mut record,
        "正式基线已确认，Guardian 将开始后台复验",
        "warning",
    );
    let reconfigured = previous.is_some();
    if let Some(old) = previous {
        record["previousBaseline"] =
            json!({"confirmedAt":old["confirmedAt"],"backup":old["reconfiguration"]["backup"]});
        event(
            &mut record,
            "目标环境验收完成，已切换正式 Runtime；旧环境和历史基线已保留",
            "success",
        );
    }
    save(&record)?;
    if let Err(error) = guardian::ensure(&record, false) {
        event(
            &mut record,
            &format!("Guardian 启动未完成：{error}"),
            "warning",
        );
        save(&record)?;
    }
    if reconfigured {
        if let Err(error) = management::observe(&record, "unlock_apps") {
            event(
                &mut record,
                &format!("新正式基线已保存，专用快捷方式尚待解锁；请从工作台重新打开应用：{error}"),
                "warning",
            );
            save(&record)?;
        }
    }
    Ok(record.to_string())
}

use super::{
    baseline::{load, save, validate_browser_with_runtime},
    event, execute, now,
};
use crate::application::{guardian, nodes, runtime::management};
use serde_json::{json, Value};

pub(super) fn read_environment(record: &Value, action: &str) -> Result<Value, String> {
    let mut details = management::observe(record, action)?;
    if !details.is_object() {
        return Err("运行环境返回的检测结果无效".into());
    }
    if details["online"] == true && details["error"].is_null() {
        if let Err(error) = validate_browser_with_runtime(record, &details["runtime"]) {
            details["error"] = json!(error);
        }
    }
    Ok(details)
}

pub(super) fn browser_snapshot(details: &Value) -> Value {
    json!({"at":details["at"], "online":details["online"], "browserData":details["browserData"], "error":details["error"]})
}

pub(super) fn refresh_observation(record: &mut Value, full: bool) {
    let observation = match read_environment(record, if full { "read_all" } else { "read" }) {
        Ok(mut details) => {
            let runtime = details["runtime"].take();
            let error = if details["online"] != true {
                json!(details["error"]
                    .as_str()
                    .unwrap_or("运行环境未连接，请检查运行状态"))
            } else {
                details["error"].clone()
            };
            let browser = if full {
                browser_snapshot(&details)
            } else {
                record["observation"]["browser"].clone()
            };
            details.as_object_mut().unwrap().remove("browserData");
            json!({"at":now(),"browser":browser,"runtime":runtime,"processes":details["processes"],"environment":details,"error":error})
        }
        Err(error) => {
            json!({"at":now(),"runtime":null,"processes":null,"browser":{"at":now(),"online":false,"error":error},"environment":{"at":now(),"state":"Unknown","online":false,"checks":[],"error":error},"error":error})
        }
    };
    let ok = observation["error"].is_null();
    record["observation"] = observation;
    event(
        record,
        if ok {
            "当前 Runtime 只读检测完成"
        } else {
            "当前 Runtime 检测未完成，请查看环境详情"
        },
        if ok { "info" } else { "warning" },
    );
}

pub(crate) fn guardian_poll() -> Result<Option<String>, String> {
    let Some(mut record) = load()? else {
        return Ok(None);
    };
    if record["reconfiguration"].is_object() || record["nodeRepair"].is_object() {
        return Ok(None);
    }
    let previous = record.clone();
    guardian::poll(&mut record)?;
    if previous == record {
        return Ok(None);
    }
    save(&record)?;
    Ok(Some(record.to_string()))
}

pub(crate) fn scheduled_refresh() -> Result<Option<String>, String> {
    let Some(mut updated) = load()? else {
        return Ok(None);
    };
    if updated["reconfiguration"].is_object() || updated["nodeRepair"].is_object() {
        return Ok(None);
    }
    let nodes_error = nodes::test_all_in_background().err();
    refresh_observation(&mut updated, true);
    if let Some(error) = nodes_error {
        event(
            &mut updated,
            &format!("节点定时测速未完成：{error}"),
            "warning",
        );
    }
    let observation = &updated["observation"];
    if observation["error"].is_null() && observation["browser"]["online"] == true {
        if observation_browser_is_idle(&updated) {
            let result = execute("browser_verify".into(), "{}".into())
                .and_then(|s| serde_json::from_str::<Value>(&s).map_err(|e| e.to_string()));
            let browser = &mut updated["observation"]["browser"];
            match result {
                Ok(result) if result["verified"] == true => {
                    let profile = &mut browser["browserData"]["profile"];
                    profile["verification"] = result["verification"].clone();
                    profile["verificationStatus"] = json!("satisfied");
                    profile["verificationError"] = Value::Null;
                }
                Ok(_) => {
                    browser["notice"] = json!("浏览器正在使用，已保留最近一次验证结果。");
                }
                Err(error) => {
                    browser["browserData"]["profile"]["verificationError"] = json!(error);
                    browser["error"] = json!(error);
                }
            }
        } else if observation["processes"]["web"]["count"]
            .as_u64()
            .unwrap_or(0)
            > 0
        {
            updated["observation"]["browser"]["notice"] =
                json!("专用浏览器正在使用，浏览器探针显示最近一次验证结果。");
        }
    }
    save(&updated)?;
    Ok(Some(updated.to_string()))
}

fn observation_browser_is_idle(record: &Value) -> bool {
    let observation = &record["observation"];
    observation["processes"]["web"]["count"] == 0
        && observation["browser"]["browserData"]["baselineMatches"] == true
        && observation["browser"]["browserData"]["profile"].is_object()
}

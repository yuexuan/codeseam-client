//! 最终初始化确认和每日只读观测。浏览器检查点
//! 不等同于正式运行环境基线；只有显式完成最终确认才会创建正式基线。
mod baseline;
mod observation;
#[cfg(test)]
mod tests;

use crate::application::{
    browser, guardian, nodes, preferences, recovery::reset, runtime::management,
};
pub(crate) use baseline::load;
use baseline::{save, valid_profile, validate_daily_browser, validate_runtime_start};
use observation::{browser_snapshot, read_environment, refresh_observation};
pub(crate) use observation::{guardian_poll, scheduled_refresh};
use serde_json::{json, Value};

fn now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}
fn event(record: &mut Value, message: &str, level: &str) {
    if let Some(events) = record["events"].as_array_mut() {
        events.push(json!({"at":now(),"message":message,"level":level}));
        // 保留完整的结构化证据；首页仅限制显示的行数。
        // 尚未解决的警告不能因常规日志轮转而消失。
    }
}
pub fn execute(action: String, payload: String) -> Result<String, String> {
    let input: Value = serde_json::from_str(&payload).map_err(|_| "工作台请求无效")?;
    if action == "preferences" {
        return Ok(preferences::read()?.to_string());
    }
    if action == "startup_preference" {
        return Ok(
            preferences::set_startup(input["enabled"].as_bool().ok_or("缺少启动偏好")?)?
                .to_string(),
        );
    }
    if action == "reset" {
        return reset::execute(input);
    }
    if action == "read" {
        return Ok(load()?.unwrap_or(Value::Null).to_string());
    }
    if action == "confirm" {
        return baseline::confirm(&input);
    }
    let mut record = load()?.ok_or("请先完成初始化确认")?;
    match action.as_str() {
        "guardian_history" => {
            return Ok(guardian::events::history(input["cursor"].as_str())?.to_string())
        }
        "node_switch" => {
            let snapshot = nodes::read()?;
            let id = input["id"].as_str().ok_or("缺少目标节点")?;
            nodes::recovery::validate_switch(&record, &snapshot, id)?;
            // 更改候选选择前，先保存已确认的国家/地区。
            if !record["nodeCountry"].is_object() {
                let target = snapshot
                    .nodes
                    .iter()
                    .find(|node| node.id == id)
                    .ok_or("节点已不存在")?;
                record["nodeCountry"] =
                    json!({"code": target.country_code, "region": target.region});
            }
            nodes::recovery::backup(&mut record)?;
            save(&record)?;
            nodes::select(id.into())?;
            return execute("node_repair".into(), "{}".into());
        }
        "node_repair" => {
            nodes::recovery::backup(&mut record)?;
            save(&record)?;
            let (baseline, runtime) = nodes::recovery::apply(&record)?;
            if !valid_profile(&baseline["profile"]) {
                return Err("节点或浏览器复验未通过，请重新应用节点".into());
            }
            record["previousBaseline"] = json!({"confirmedAt":record["confirmedAt"],"backup":record["nodeRepair"]["backup"]});
            record["baseline"] = baseline;
            record["runtime"] = runtime;
            record["confirmedAt"] = json!(now());
            record["baselineVersion"] = json!(record["baselineVersion"].as_u64().unwrap_or(1) + 1);
            record["observation"] = Value::Null;
            // 解锁启动器前，先持久化候选环境标识，以便重启或重试。
            save(&record)?;
            management::observe(&record, "unlock_apps")?;
            record["nodeRepair"] = Value::Null;
            event(
                &mut record,
                "节点配置已应用，出口与专用浏览器复验通过；历史基线已保留",
                "success",
            );
            save(&record)?;
            guardian::ensure(&record, false)?;
        }
        "runtime_start" => {
            validate_runtime_start(&record)?;
            // 先恢复本应用管理的运行环境。待处理的节点操作属于后续连接检查，
            // 不应被误判为虚拟机故障。
            if record["virtualRuntime"] == true {
                let result = management::observe(&record, "start")?;
                guardian::ensure(&record, false)?;
                return Ok(result.to_string());
            }
            guardian::ensure(&record, false)?;
            return Ok(json!({"ready":true}).to_string());
        }
        "runtime_stop" => {
            if record["virtualRuntime"] != true {
                return Err("本机运行不支持关闭宿主机".into());
            }
            let result = management::observe(&record, "stop");
            refresh_observation(&mut record, false);
            event(
                &mut record,
                if result.is_ok() {
                    "虚拟机已正常关闭，Guest 应用离线"
                } else {
                    "虚拟机关机未完成，请检查真实运行状态"
                },
                if result.is_ok() { "info" } else { "warning" },
            );
            save(&record)?;
            result?;
        }
        "guardian_recover" => {
            if record["reconfiguration"].is_object() || record["nodeRepair"].is_object() {
                return Err("请先完成当前环境或节点操作".into());
            }
            validate_daily_browser(&record)?;
            management::app_action(&record, "repair", "", false)?;
            guardian::ensure(&record, true)?;
            event(
                &mut record,
                "用户请求按原正式基线重新复验；账号已重新确认，复验通过前保持锁定",
                "info",
            );
            save(&record)?;
        }
        "app_start" | "app_stop" => {
            let kind = input["app"]
                .as_str()
                .filter(|s| matches!(*s, "web" | "code" | "desktop"))
                .ok_or("应用类型无效")?;
            if action == "app_start" {
                if kind == "web" {
                    return execute("open".into(), "{}".into());
                }
                validate_daily_browser(&record)?;
                guardian::allows_launch(&record)?;
            }
            let result = management::app_action(
                &record,
                if action == "app_start" {
                    "start"
                } else {
                    "stop"
                },
                kind,
                true,
            )?;
            if action == "app_stop" && result["stopped"] != true {
                return Err("仍有身份待确认的进程，未将其强制关闭，请核对进程详情".into());
            }
            event(
                &mut record,
                &format!(
                    "Claude {kind} 已{}",
                    if action == "app_start" {
                        "请求启动"
                    } else {
                        "停止"
                    }
                ),
                "info",
            );
            save(&record)?;
        }
        "exit_prepare" => {
            let result = management::app_action(&record, "stop", "", input["force"] == true)?;
            if result["stopped"] != true {
                return Ok(result.to_string());
            }
            management::app_action(&record, "shutdown", "", false)?;
            guardian::stop(&record)?;
            return Ok(json!({"stopped":true,"remaining":[]}).to_string());
        }
        "browser_details" => {
            return Ok(management::observe(&record, "read_browser")?.to_string());
        }
        "browser_open" => return execute("open".into(), "{}".into()),
        "browser_verify" | "browser_recreate" => {
            if record["reconfiguration"].is_object() {
                return Err("请先完成或取消运行环境重新配置".into());
            }
            validate_daily_browser(&record)?;
            let operation = action.trim_start_matches("browser_");
            return browser::execute(
                record["virtualRuntime"] == true,
                record["baseline"]["profile"]["browserId"]
                    .as_str()
                    .ok_or("浏览器记录无效")?
                    .into(),
                operation.into(),
            );
        }
        "runtime_details" => return Ok(read_environment(&record, "read")?.to_string()),
        "runtime_console" => return Ok(management::observe(&record, "open_console")?.to_string()),
        "reconfigure_begin" => {
            management::begin(&mut record, &input)?;
            event(
                &mut record,
                "已备份当前正式基线并暂停受管应用，开始准备候选运行环境",
                "info",
            );
            save(&record)?;
        }
        "reconfigure_cancel" => {
            management::observe(&record, "unlock_apps")?;
            management::cancel(&mut record)?;
            event(
                &mut record,
                "已取消运行环境切换，原正式 Runtime 与数据已保留",
                "info",
            );
            save(&record)?;
            guardian::ensure(&record, false)?;
        }
        "refresh_browser" => {
            let details = management::observe(&record, "read_browser")?;
            record["observation"]["browser"] = browser_snapshot(&details);
            save(&record)?;
        }
        "refresh" | "refresh_runtime" => {
            refresh_observation(&mut record, action == "refresh");
            save(&record)?;
        }
        "open" | "install_code" | "install_desktop" => {
            if record["reconfiguration"].is_object() {
                return Err("运行环境正在重新配置，请完成或取消后再启动应用".into());
            }
            validate_daily_browser(&record)?;
            guardian::allows_launch(&record)?;
            let p = &record["baseline"]["profile"];
            browser::execute(
                record["virtualRuntime"] == true,
                p["browserId"].as_str().ok_or("浏览器记录无效")?.into(),
                action.clone(),
            )?;
            event(
                &mut record,
                if action == "open" {
                    "已请求打开当前 Runtime 的专用 Claude Web 浏览器"
                } else {
                    "已通过当前 Runtime 专用浏览器打开官方安装入口"
                },
                "info",
            );
            save(&record)?;
        }
        _ => return Err("未知工作台操作".into()),
    }
    Ok(record.to_string())
}

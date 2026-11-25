//! 最终初始化确认和每日只读观测。浏览器检查点
//! 不等同于正式运行环境基线；只有显式完成最终确认才会创建正式基线。
use crate::infrastructure::vault;
use serde_json::{json, Value};
const RECORD: &str = "workbench-v1.dpapi";

fn now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}
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
fn event(record: &mut Value, message: &str, level: &str) {
    if let Some(events) = record["events"].as_array_mut() {
        events.push(json!({"at":now(),"message":message,"level":level}));
        // 保留完整的结构化证据；首页仅限制显示的行数。
        // 尚未解决的警告不能因常规日志轮转而消失。
    }
}
fn valid_profile(p: &Value) -> bool {
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
fn validate_daily_browser(record: &Value) -> Result<(), String> {
    validate_browser_with_runtime(record, &Value::Null)
}
fn validate_runtime_start(record: &Value) -> Result<(),String> {
    if record["reconfiguration"].is_object() { return Err("请先完成或取消运行环境重新配置".into()) } Ok(())
}

fn validate_browser_with_runtime(record: &Value, observed: &Value) -> Result<(), String> {
    if record["nodeRepair"].is_object() { return Err("节点修复尚未完成，请打开节点编辑并重新应用".into()); }
    let p = &record["baseline"]["profile"];
    let snapshot = super::nodes::read()?;
    if !snapshot.nodes.iter().any(|n| {
        Some(&n.id) == snapshot.selected_id.as_ref()
            && p["nodeId"] == n.id
            && p["verification"]["exitIp"].as_str() == n.exit_ip.as_deref()
    }) {
        return Err("所选节点或出口已偏离正式基线，请先重新确认环境".into());
    }
    if record["virtualRuntime"] != true {
        let current = if observed.is_null() {
            serde_json::to_value(super::runtime::read()?).map_err(|e| e.to_string())?
        } else { observed.clone() };
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

fn read_environment(record: &Value, action: &str) -> Result<Value, String> {
    let mut details = super::runtime_management::observe(record, action)?;
    if !details.is_object() { return Err("运行环境返回的检测结果无效".into()); }
    if details["online"] == true && details["error"].is_null() {
        if let Err(error) = validate_browser_with_runtime(record, &details["runtime"]) {
            details["error"] = json!(error);
        }
    }
    Ok(details)
}

fn browser_snapshot(details: &Value) -> Value {
    json!({"at":details["at"], "online":details["online"], "browserData":details["browserData"], "error":details["error"]})
}

fn refresh_observation(record: &mut Value, full: bool) {
    let observation = match read_environment(record, if full { "read_all" } else { "read" }) {
        Ok(mut details) => {
            let runtime = details["runtime"].take();
            let error = if details["online"] != true {
                json!(details["error"].as_str().unwrap_or("运行环境未连接，请检查运行状态"))
            } else { details["error"].clone() };
            let browser = if full { browser_snapshot(&details) } else { record["observation"]["browser"].clone() };
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
    let Some(mut record)=load()? else { return Ok(None) };
    if record["reconfiguration"].is_object() || record["nodeRepair"].is_object() { return Ok(None) }
    let previous=record.clone();
    super::guardian::poll(&mut record)?;
    if previous==record { return Ok(None) }
    save(&record)?; Ok(Some(record.to_string()))
}

pub(crate) fn scheduled_refresh() -> Result<Option<String>, String> {
    let Some(mut updated) = load()? else { return Ok(None) };
    if updated["reconfiguration"].is_object() || updated["nodeRepair"].is_object() {
        return Ok(None);
    }
    let nodes_error = super::nodes::test_all_in_background().err();
    refresh_observation(&mut updated, true);
    if let Some(error) = nodes_error {
        event(&mut updated, &format!("节点定时测速未完成：{error}"), "warning");
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
                Ok(_) => { browser["notice"] = json!("浏览器正在使用，已保留最近一次验证结果。"); }
                Err(error) => {
                    browser["browserData"]["profile"]["verificationError"] = json!(error);
                    browser["error"] = json!(error);
                }
            }
        } else if observation["processes"]["web"]["count"].as_u64().unwrap_or(0) > 0 {
            updated["observation"]["browser"]["notice"] = json!("专用浏览器正在使用，浏览器探针显示最近一次验证结果。");
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
pub fn execute(action: String, payload: String) -> Result<String, String> {
    let input: Value = serde_json::from_str(&payload).map_err(|_| "工作台请求无效")?;
    if action=="preferences" { return Ok(super::lifecycle::preferences()?.to_string()) }
    if action=="startup_preference" { return Ok(super::lifecycle::set_startup(input["enabled"].as_bool().ok_or("缺少启动偏好")?)?.to_string()) }
    if action == "reset" {
        return super::reset::execute(input);
    }
    if action == "read" {
        return Ok(load()?.unwrap_or(Value::Null).to_string());
    }
    if action == "confirm" {
        let previous = load()?;
        let alias = input["alias"].as_str().unwrap_or("").trim();
        let region = input["region"].as_str().unwrap_or("").trim();
        if alias.chars().count() > 80 || region.chars().count() > 80 {
            return Err("账号备注最多 80 个字符".into());
        }
        let virtual_runtime = super::runtime_management::validate_confirmation(previous.as_ref(), input["virtualRuntime"].as_bool())?;
        let browser = input["browser"].as_str().ok_or("缺少浏览器")?.to_string();
        // 重新读取并验证可信的原生证据，不接受客户端传入的通过标记。
        let baseline: Value = serde_json::from_str(&super::browser::execute(
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
            let report = super::runtime::read()?;
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
        let cleanup = serde_json::to_value(super::claude::read()?).map_err(|e| e.to_string())?;
        let mut record = json!({"schema":1,"confirmedAt":now(),"alias":alias,"region":region,"virtualRuntime":virtual_runtime,"baseline":baseline,"runtime":runtime,"cleanup":cleanup,"observation":null,"events":[]});
        let snapshot = super::nodes::read()?;
        if let Some(node) = snapshot.nodes.iter().find(|node| record["baseline"]["profile"]["nodeId"] == node.id) {
            record["nodeCountry"] = json!({"code": node.country_code, "region": node.region});
        }
        record["baselineVersion"] = json!(previous.as_ref().map(|old| old["baselineVersion"].as_u64().unwrap_or(1) + 1).unwrap_or(1));
        event(&mut record, "用户确认初始化，正式环境基线已保存", "success");
        event(
            &mut record,
            "正式基线已确认，Guardian 将开始后台复验",
            "warning",
        );
        let reconfigured = previous.is_some();
        if let Some(old) = previous {
            record["previousBaseline"] = json!({"confirmedAt":old["confirmedAt"],"backup":old["reconfiguration"]["backup"]});
            event(&mut record, "目标环境验收完成，已切换正式 Runtime；旧环境和历史基线已保留", "success");
        }
        save(&record)?;
        if let Err(error)=super::guardian::ensure(&record,false) {
            event(&mut record,&format!("Guardian 启动未完成：{error}"),"warning"); save(&record)?;
        }
        if reconfigured {
            if let Err(error) = super::runtime_management::observe(&record, "unlock_apps") {
                event(&mut record, &format!("新正式基线已保存，专用快捷方式尚待解锁；请从工作台重新打开应用：{error}"), "warning");
                save(&record)?;
            }
        }
        return Ok(record.to_string());
    }
    let mut record = load()?.ok_or("请先完成初始化确认")?;
    match action.as_str() {
        "guardian_history" => return Ok(super::guardian_events::history(input["cursor"].as_str())?.to_string()),
        "node_switch" => {
            let snapshot = super::nodes::read()?;
            let id = input["id"].as_str().ok_or("缺少目标节点")?;
            super::node_recovery::validate_switch(&record, &snapshot, id)?;
            // 更改候选选择前，先保存已确认的国家/地区。
            if !record["nodeCountry"].is_object() {
                let target = snapshot.nodes.iter().find(|node| node.id == id).ok_or("节点已不存在")?;
                record["nodeCountry"] = json!({"code": target.country_code, "region": target.region});
            }
            super::node_recovery::backup(&mut record)?;
            save(&record)?;
            super::nodes::select(id.into())?;
            return execute("node_repair".into(), "{}".into());
        }
        "node_repair" => {
            super::node_recovery::backup(&mut record)?;
            save(&record)?;
            let (baseline, runtime) = super::node_recovery::apply(&record)?;
            if !valid_profile(&baseline["profile"]) { return Err("节点或浏览器复验未通过，请重新应用节点".into()); }
            record["previousBaseline"] = json!({"confirmedAt":record["confirmedAt"],"backup":record["nodeRepair"]["backup"]});
            record["baseline"] = baseline;
            record["runtime"] = runtime;
            record["confirmedAt"] = json!(now());
            record["baselineVersion"] = json!(record["baselineVersion"].as_u64().unwrap_or(1) + 1);
            record["observation"] = Value::Null;
            // 解锁启动器前，先持久化候选环境标识，以便重启或重试。
            save(&record)?;
            super::runtime_management::observe(&record, "unlock_apps")?;
            record["nodeRepair"] = Value::Null;
            event(&mut record, "节点配置已应用，出口与专用浏览器复验通过；历史基线已保留", "success");
            save(&record)?;
            super::guardian::ensure(&record,false)?;
        }
        "runtime_start" => {
            validate_runtime_start(&record)?;
            // 先恢复本应用管理的运行环境。待处理的节点操作属于后续连接检查，
            // 不应被误判为虚拟机故障。
            if record["virtualRuntime"] == true {
                let result=super::runtime_management::observe(&record, "start")?;
                super::guardian::ensure(&record, false)?;
                return Ok(result.to_string());
            }
            super::guardian::ensure(&record, false)?;
            return Ok(json!({"ready":true}).to_string());
        }
        "runtime_stop" => {
            if record["virtualRuntime"] != true { return Err("本机运行不支持关闭宿主机".into()) }
            let result=super::runtime_management::observe(&record,"stop");
            refresh_observation(&mut record, false);
            event(&mut record, if result.is_ok() {"虚拟机已正常关闭，Guest 应用离线"} else {"虚拟机关机未完成，请检查真实运行状态"}, if result.is_ok() {"info"} else {"warning"});
            save(&record)?; result?;
        }
        "guardian_recover" => {
            if record["reconfiguration"].is_object() || record["nodeRepair"].is_object() { return Err("请先完成当前环境或节点操作".into()) }
            validate_daily_browser(&record)?;
            super::runtime_management::app_action(&record,"repair","",false)?;
            super::guardian::ensure(&record, true)?;
            event(&mut record,"用户请求按原正式基线重新复验；账号已重新确认，复验通过前保持锁定","info");
            save(&record)?;
        }
        "app_start" | "app_stop" => {
            let kind=input["app"].as_str().filter(|s| matches!(*s,"web"|"code"|"desktop")).ok_or("应用类型无效")?;
            if action=="app_start" {
                if kind=="web" { return execute("open".into(),"{}".into()) }
                validate_daily_browser(&record)?; super::guardian::allows_launch(&record)?;
            }
            let result=super::runtime_management::app_action(&record,if action=="app_start" {"start"} else {"stop"},kind,true)?;
            if action=="app_stop" && result["stopped"]!=true { return Err("仍有身份待确认的进程，未将其强制关闭，请核对进程详情".into()) }
            event(&mut record,&format!("Claude {kind} 已{}",if action=="app_start" {"请求启动"} else {"停止"}),"info");
            save(&record)?;
        }
        "exit_prepare" => {
            let result=super::runtime_management::app_action(&record,"stop","",input["force"]==true)?;
            if result["stopped"]!=true { return Ok(result.to_string()) }
            super::runtime_management::app_action(&record,"shutdown","",false)?;
            super::guardian::stop(&record)?;
            return Ok(json!({"stopped":true,"remaining":[]}).to_string());
        }
        "browser_details" => {
            return Ok(super::runtime_management::observe(&record, "read_browser")?.to_string());
        }
        "browser_open" => return execute("open".into(), "{}".into()),
        "browser_verify" | "browser_recreate" => {
            if record["reconfiguration"].is_object() { return Err("请先完成或取消运行环境重新配置".into()); }
            validate_daily_browser(&record)?;
            let operation = action.trim_start_matches("browser_");
            return super::browser::execute(record["virtualRuntime"] == true, record["baseline"]["profile"]["browserId"].as_str().ok_or("浏览器记录无效")?.into(), operation.into());
        }
        "runtime_details" => return Ok(read_environment(&record, "read")?.to_string()),
        "runtime_console" => return Ok(super::runtime_management::observe(&record, "open_console")?.to_string()),
        "reconfigure_begin" => {
            super::runtime_management::begin(&mut record, &input)?;
            event(&mut record, "已备份当前正式基线并暂停受管应用，开始准备候选运行环境", "info");
            save(&record)?;
        }
        "reconfigure_cancel" => {
            super::runtime_management::observe(&record, "unlock_apps")?;
            super::runtime_management::cancel(&mut record)?;
            event(&mut record, "已取消运行环境切换，原正式 Runtime 与数据已保留", "info");
            save(&record)?;
            super::guardian::ensure(&record,false)?;
        }
        "refresh_browser" => {
            let details = super::runtime_management::observe(&record, "read_browser")?;
            record["observation"]["browser"] = browser_snapshot(&details);
            save(&record)?;
        }
        "refresh" | "refresh_runtime" => {
            refresh_observation(&mut record, action == "refresh");
            save(&record)?;
        }
        "open" | "install_code" | "install_desktop" => {
            if record["reconfiguration"].is_object() { return Err("运行环境正在重新配置，请完成或取消后再启动应用".into()); }
            validate_daily_browser(&record)?;
            super::guardian::allows_launch(&record)?;
            let p = &record["baseline"]["profile"];
            super::browser::execute(
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Reads the confirmed environment and browser together without saving or starting applications"]
    fn installed_combined_snapshot() {
        let record = load().unwrap().expect("formal baseline");
        let snapshot = read_environment(&record, "read_all").unwrap();
        assert_eq!(snapshot["online"], true, "{}", snapshot["error"]);
        assert!(snapshot["checks"].is_array());
        assert!(snapshot["processes"]["web"]["count"].is_number());
        assert!(snapshot["browserData"]["profile"]["profileId"].is_string(), "{}", snapshot["browserData"]["error"]);
        println!("Combined snapshot returned environment checks, application counts and the managed browser profile.");
    }
    #[test]
    #[ignore = "Read-only current formal Runtime observation; does not start or change the Guest"]
    fn installed_daily_runtime_observation() {
        let result = execute("runtime_details".into(), "{}".into()).unwrap();
        let value: Value = serde_json::from_str(&result).unwrap();
        assert!(value["state"].is_string(), "{value}");
        assert!(value["checks"].is_array(), "{value}");
        let path = std::path::Path::new("../docs/tasks/evidence/2026-11-24-runtime-environment");
        std::fs::create_dir_all(path).unwrap();
        std::fs::write(path.join("native-observation.json"), serde_json::to_vec_pretty(&value).unwrap()).unwrap();
        println!("{}", result);
    }
    #[test]
    fn final_confirmation_rejects_incomplete_or_forged_browser_evidence() {
        let mut p = json!({"proxyStatus":"satisfied","parametersStatus":"satisfied","shortcutStatus":"satisfied","verificationStatus":"satisfied","baselineStatus":"satisfied","timezoneStatus":"satisfied","confirmed":true,"compatibility":{"status":"satisfied"},"targetTimezone":"Asia/Singapore","verification":{"ok":true,"exitIp":"203.0.113.10","observed":{"timezone":"Asia/Singapore"}}});
        assert!(valid_profile(&p));
        p["confirmed"] = false.into();
        assert!(!valid_profile(&p));
        p["confirmed"] = true.into();
        p["verification"]["observed"]["timezone"] = "Asia/Tokyo".into();
        assert!(!valid_profile(&p));
        p["verification"]["observed"]["timezone"] = "Asia/Singapore".into();
        p["verification"]["exitIp"] = "unknown".into();
        assert!(!valid_profile(&p));
    }
    #[test]
    #[cfg(windows)]
    fn restart_preserves_last_observation_and_refresh_keeps_the_formal_baseline() {
        let _lock = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
        let root = std::env::temp_dir().join(format!("codeseam-workbench-{}", std::process::id()));
        let prior = std::env::var_os("CODESEAM_TEST_DATA_DIR");
        std::env::set_var("CODESEAM_TEST_DATA_DIR", &root);
        let result = std::panic::catch_unwind(|| {
            assert!(load().unwrap().is_none());
            assert_eq!(execute("read".into(), "{}".into()).unwrap(), "null");
            let profile = json!({"proxyStatus":"satisfied","parametersStatus":"satisfied","shortcutStatus":"satisfied","verificationStatus":"satisfied","baselineStatus":"satisfied","timezoneStatus":"satisfied","confirmed":true,"compatibility":{"status":"satisfied"},"targetTimezone":"Asia/Singapore","verification":{"ok":true,"exitIp":"203.0.113.10","observed":{"timezone":"Asia/Singapore"}}});
            let record = json!({"schema":1,"virtualRuntime":true,"alias":"本地别名","baseline":{"profile":profile},"observation":{"healthy":true},"events":[]});
            save(&record).unwrap();
            let reopened: Value =
                serde_json::from_str(&execute("read".into(), "{}".into()).unwrap()).unwrap();
            assert_eq!(reopened["observation"], record["observation"]);
            assert_eq!(reopened["alias"], "本地别名");
            assert_eq!(reopened["baseline"], record["baseline"]);
            let mut native_record = record.clone();
            native_record["virtualRuntime"] = json!(false);
            save(&native_record).unwrap();
            assert!(validate_runtime_start(&native_record).is_ok());
            assert!(validate_daily_browser(&native_record).unwrap_err().contains("所选节点"));
            assert_eq!(load().unwrap().unwrap()["baseline"], record["baseline"]);
            native_record["nodeRepair"] = json!({"backup":"RuntimeHistory/pending-node"});
            save(&native_record).unwrap();
            assert!(validate_runtime_start(&native_record).is_ok());
            assert!(validate_daily_browser(&native_record).unwrap_err().contains("节点修复尚未完成"));
            assert_eq!(load().unwrap().unwrap()["nodeRepair"], native_record["nodeRepair"]);
            native_record["reconfiguration"] = json!({"virtualRuntime":true});
            save(&native_record).unwrap();
            assert!(validate_runtime_start(&native_record).unwrap_err().contains("重新配置"));
            save(&record).unwrap();
            assert!(execute("confirm".into(), "{}".into())
                .unwrap_err()
                .contains("已有正式基线"));
            let refreshed: Value =
                serde_json::from_str(&execute("refresh".into(), "{}".into()).unwrap()).unwrap();
            assert_eq!(refreshed["baseline"], record["baseline"]);
            assert!(refreshed["observation"]["runtime"].is_null());
            assert!(refreshed["observation"]["error"].is_string());
            assert!(refreshed["observation"]["processes"].is_null());
            vault::save(RECORD, br#"{"schema":99}"#).unwrap();
            let damaged = std::fs::read(vault::dir().unwrap().join(RECORD)).unwrap();
            assert!(execute("read".into(), "{}".into()).is_err());
            assert_eq!(
                std::fs::read(vault::dir().unwrap().join(RECORD)).unwrap(),
                damaged
            );
        });
        match prior {
            Some(value) => std::env::set_var("CODESEAM_TEST_DATA_DIR", value),
            None => std::env::remove_var("CODESEAM_TEST_DATA_DIR"),
        }
        // 只删除此测试专用的固定临时目录。
        std::fs::remove_dir_all(root).unwrap();
        if let Err(error) = result {
            std::panic::resume_unwind(error);
        }
    }
}

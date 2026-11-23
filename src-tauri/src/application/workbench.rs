//! 最终初始化确认和每日只读观测。浏览器检查点
//! 不等同于正式运行环境基线；只有显式完成最终确认才会创建正式基线。
use crate::infrastructure::{vault, windows};
use serde_json::{json, Value};
const RECORD: &str = "workbench-v1.dpapi";

fn now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}
fn load() -> Result<Option<Value>, String> {
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
fn save(value: &Value) -> Result<(), String> {
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
pub fn execute(action: String, payload: String) -> Result<String, String> {
    let input: Value = serde_json::from_str(&payload).map_err(|_| "工作台请求无效")?;
    if action == "read" {
        let mut record = load()?.unwrap_or(Value::Null);
        // 之前的观测仅作为证据，重启后不能据此重新判定为通过。
        if record.is_object() {
            record["observation"] = Value::Null;
        }
        return Ok(record.to_string());
    }
    if action == "confirm" {
        if load()?.is_some() {
            return Err("已有正式基线，请从工作台查看当前环境".into());
        }
        let alias = input["alias"].as_str().unwrap_or("").trim();
        let region = input["region"].as_str().unwrap_or("").trim();
        if alias.chars().count() > 80 || region.chars().count() > 80 {
            return Err("账号备注最多 80 个字符".into());
        }
        let virtual_runtime = input["virtualRuntime"].as_bool().ok_or("缺少运行环境")?;
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
        event(&mut record, "用户确认初始化，正式环境基线已保存", "success");
        event(
            &mut record,
            "持续 Guardian 与进程路径保护尚未接通，保护状态待验证",
            "warning",
        );
        save(&record)?;
        return Ok(record.to_string());
    }
    let mut record = load()?.ok_or("请先完成初始化确认")?;
    match action.as_str() {
        "refresh" => {
            let virtual_runtime = record["virtualRuntime"] == true;
            // 此处不调用准备或确认操作：每日刷新不能更改浏览器、
            // 宿主机设置、所选节点或不可变的正式基线。
            let observation = if virtual_runtime {
                json!({"at":now(),"runtime":null,"processes":null,"error":"Guest 的日常只读观测尚未接通；初始化证据仍保留，当前状态待验证"})
            } else {
                let runtime = super::runtime::read();
                let processes =
                    windows::run_script::<Value>(include_bytes!("../infrastructure/workbench.ps1"));
                match (runtime, processes) {
                    (Ok(r), Ok(p)) => json!({"at":now(),"runtime":r,"processes":p,"error":null}),
                    (r, p) => {
                        json!({"at":now(),"runtime":null,"processes":null,"error":r.err().or(p.err()).unwrap_or_else(|| "观测未完成".into())})
                    }
                }
            };
            let ok = observation["error"].is_null();
            record["observation"] = observation;
            event(
                &mut record,
                if ok {
                    "当前 Runtime 只读检测完成；进程保护路径仍待验证"
                } else {
                    "当前 Runtime 检测未完成，请查看环境详情"
                },
                if ok { "info" } else { "warning" },
            );
            save(&record)?;
        }
        "open" | "install_code" | "install_desktop" => {
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
                let current = super::runtime::read()?;
                if !current.confirmed || record["runtime"]["revision"] != current.revision {
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
    fn restart_and_refresh_preserve_formal_baseline_and_do_not_reuse_old_health() {
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
            assert!(reopened["observation"].is_null());
            assert_eq!(reopened["alias"], "本地别名");
            assert_eq!(reopened["baseline"], record["baseline"]);
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

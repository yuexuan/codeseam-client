//! 计划任务负责持续巡检，界面读取经 DPAPI 保护的最新观测。
pub(crate) mod events;

use crate::infrastructure::vault;
use crate::platform::guardian::{control, generation};
use serde_json::{json, Value};
fn timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
pub fn ensure(record: &Value, recover: bool) -> Result<(), String> {
    #[cfg(not(test))]
    crate::application::preferences::initialize()?;
    if !recover {
        if let Ok(Some(bytes)) = vault::read("guardian-v1.dpapi") {
            if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                if value["generation"] == generation(record) && fresh(&value, timestamp()) {
                    return Ok(());
                }
            }
        }
    }
    control("install", record, recover)?;
    Ok(())
}
pub fn stop(record: &Value) -> Result<(), String> {
    control("stop", record, false)?;
    vault::save("guardian-v1.dpapi", &serde_json::to_vec(&json!({"schema":1,"generation":generation(record),"heartbeat":0,"at":timestamp().to_string(),"online":false,"state":"unknown","vmState":"Unknown","error":"Guardian 已停止，等待下次恢复"})).map_err(|e|e.to_string())?)?;
    Ok(())
}
fn fresh(value: &Value, now: u64) -> bool {
    value["heartbeat"]
        .as_u64()
        .is_some_and(|at| at <= now + 5 && now.saturating_sub(at) < 20)
}
pub fn allows_launch(record: &Value) -> Result<(), String> {
    let bytes = vault::read("guardian-v1.dpapi")?.ok_or("Guardian 尚未启动，请在工作台复验")?;
    let current: Value = serde_json::from_slice(&bytes).map_err(|_| "Guardian 状态损坏")?;
    if current["generation"] != generation(record)
        || !fresh(&current, timestamp())
        || current["online"] != true
        || !matches!(current["state"].as_str(), Some("monitoring" | "limited"))
    {
        return Err(current["error"]
            .as_str()
            .unwrap_or("Guardian 状态未就绪，已暂停应用启动")
            .into());
    }
    Ok(())
}
pub fn merge(record: &mut Value, mut snapshot: Value, now: u64) {
    if snapshot["generation"] != generation(record) || !fresh(&snapshot, now) {
        snapshot = json!({"state":"unknown","online":false,"vmState":"Unknown","error":"Guardian 心跳已过期或基线已变化，当前状态待复验","at":now.to_string(),"events":[]});
    }
    let online = snapshot["online"] == true;
    if !record["observation"].is_object() {
        record["observation"] = json!({"runtime":null,"browser":null});
    }
    let prior = record["observation"]["environment"].clone();
    let mut environment = if prior.is_object() {
        prior
    } else {
        json!({"platform":if record["virtualRuntime"] == true {"Hyper-V"} else {"Native"},"checks":[]})
    };
    environment["at"] = snapshot["at"].clone();
    environment["online"] = json!(online);
    environment["state"] = snapshot["vmState"].clone();
    environment["error"] = snapshot["error"].clone();
    for key in ["name", "cpu", "memory"] {
        if !snapshot[key].is_null() {
            environment[key] = snapshot[key].clone()
        }
    }
    if !online {
        for key in [
            "system",
            "language",
            "timezone",
            "cpuUsage",
            "memoryAvailable",
            "diskAvailable",
            "exitIp",
        ] {
            environment[key] = Value::Null;
        }
        environment["checks"] = json!([]);
        record["observation"]["runtime"] = Value::Null;
        record["observation"]["browser"] =
            json!({"at":snapshot["at"],"online":false,"error":snapshot["error"]});
    } else if record["virtualRuntime"] == true {
        environment["exitIp"] = snapshot["exitIp"].clone();
        environment["checks"] = snapshot["checks"].clone();
        if let Some(checks) = environment["checks"].as_array_mut() {
            checks.push(json!({"id":"exit","value":snapshot["exitIp"].as_str().unwrap_or("出口待复验"),"status":if snapshot["state"]=="monitoring" && snapshot["exitIp"]==record["baseline"]["profile"]["verification"]["exitIp"] {"satisfied"} else {"unknown"},"label":if snapshot["state"]=="monitoring" {"与基线一致"} else {"待复验"}}));
        }
    }
    record["observation"]["at"] = snapshot["at"].clone();
    record["observation"]["environment"] = environment;
    record["observation"]["processes"] = if online {
        snapshot["processes"].clone()
    } else {
        Value::Null
    };
    record["observation"]["error"] = snapshot["error"].clone();
    record["guardian"] = json!({"state":snapshot["state"],"at":snapshot["at"],"error":snapshot["error"],"limitation":snapshot["limitation"],"verifiedAt":snapshot["verifiedAt"]});
    if let Some(events) = snapshot["events"].as_array() {
        for event in events {
            if !record["guardianEventIds"]
                .as_array()
                .is_some_and(|ids| ids.iter().any(|id| id == &event["id"]))
                && !record["events"]
                    .as_array()
                    .is_some_and(|old| old.iter().any(|e| e["id"] == event["id"]))
            {
                if let Some(target) = record["events"].as_array_mut() {
                    target.push(event.clone())
                }
            }
        }
        if !events.is_empty() {
            record["guardianEventIds"] = json!(events
                .iter()
                .map(|event| event["id"].clone())
                .collect::<Vec<_>>());
        }
    }
}
pub fn poll(record: &mut Value) -> Result<(), String> {
    let value = vault::read("guardian-v1.dpapi")
        .and_then(|bytes| bytes.ok_or("Guardian 尚未启动".into()))
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).map_err(|e| e.to_string()));
    merge(record, value.unwrap_or(Value::Null), timestamp());
    crate::application::guardian::events::archive(record)?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn record() -> Value {
        json!({"virtualRuntime":true,"baseline":{"profile":{"runtimeId":"owned","verification":{"exitIp":"203.0.113.1"}}},"events":[],"observation":{"environment":{"online":true,"state":"Running","exitIp":"old","system":"old","checks":[{"status":"satisfied"}]},"processes":{"web":{"count":1}},"browser":{"online":true}}})
    }
    #[test]
    fn stopped_or_stale_runtime_never_keeps_old_green_evidence() {
        for state in ["Off", "Saved", "Paused", "Unknown"] {
            let mut r = record();
            let baseline = r["baseline"].clone();
            let g = generation(&r);
            merge(
                &mut r,
                json!({"generation":g,"heartbeat":100,"at":"100","online":false,"state":"offline","vmState":state,"error":"offline"}),
                101,
            );
            assert_eq!(r["observation"]["environment"]["state"], state);
            assert_eq!(r["observation"]["environment"]["online"], false);
            assert!(r["observation"]["environment"]["exitIp"].is_null());
            assert!(r["observation"]["processes"].is_null());
            assert_eq!(r["observation"]["browser"]["online"], false);
            assert_eq!(r["baseline"], baseline);
        }
        let mut r = record();
        let g = generation(&r);
        merge(
            &mut r,
            json!({"generation":g,"heartbeat":100,"online":true,"state":"monitoring"}),
            121,
        );
        assert_eq!(r["guardian"]["state"], "unknown");
        assert_eq!(r["observation"]["environment"]["online"], false);
    }
    #[test]
    fn event_import_is_idempotent_and_another_runtime_cannot_supply_evidence() {
        let mut r = record();
        let g = generation(&r);
        let snapshot = json!({"generation":g,"heartbeat":100,"at":"100","online":true,"state":"monitoring","vmState":"Running","checks":[],"events":[{"id":"e1","message":"VM stopped"}]});
        merge(&mut r, snapshot.clone(), 101);
        merge(&mut r, snapshot, 102);
        assert_eq!(r["events"].as_array().unwrap().len(), 1);
        merge(
            &mut r,
            json!({"generation":"other","heartbeat":102,"online":true}),
            103,
        );
        assert_eq!(r["observation"]["environment"]["online"], false);
    }
    #[test]
    #[ignore = "Installs/restarts the real background Guardian for the existing formal Runtime"]
    fn installed_guardian_live() {
        let record = crate::application::workbench::load()
            .unwrap()
            .expect("formal Runtime");
        ensure(&record, true).unwrap();
        for _ in 0..20 {
            std::thread::sleep(std::time::Duration::from_secs(3));
            let bytes = vault::read("guardian-v1.dpapi")
                .unwrap()
                .expect("heartbeat");
            let value: Value = serde_json::from_slice(&bytes).unwrap();
            if value["generation"] == generation(&record) && fresh(&value, timestamp()) {
                println!(
                    "Guardian state={}, online={}, VM={}, reason={}",
                    value["state"], value["online"], value["vmState"], value["error"]
                );
                if matches!(
                    value["state"].as_str(),
                    Some("monitoring" | "limited" | "offline")
                ) {
                    assert!(
                        !crate::application::guardian::events::history(None).unwrap()["events"]
                            .as_array()
                            .unwrap()
                            .is_empty(),
                        "independent daemon history must be readable without the UI"
                    );
                    return;
                }
                assert_ne!(
                    value["state"], "locked",
                    "Guardian locked: {}",
                    value["error"]
                );
            }
        }
        panic!("Guardian did not produce a usable fresh observation");
    }
    #[test]
    #[ignore = "Recovers the formal Guest, verifies its browser path, opens/stops only its managed browser and checks safe exit/restart"]
    fn installed_guardian_lifecycle_live() {
        let before = crate::application::workbench::load()
            .unwrap()
            .expect("formal Runtime");
        let execute = |action: &str, payload: &str| -> Value {
            serde_json::from_str(
                &crate::application::workbench::execute(action.into(), payload.into()).unwrap(),
            )
            .unwrap()
        };
        let wait_ready = || {
            for _ in 0..30 {
                if allows_launch(&before).is_ok() {
                    return;
                }
                std::thread::sleep(std::time::Duration::from_secs(2));
            }
            panic!(
                "Guardian did not recover to a launchable state: {:?}",
                allows_launch(&before)
            );
        };
        execute("guardian_recover", "{}");
        wait_ready();
        let verified = execute("browser_verify", "{}");
        assert_eq!(verified["verified"], true, "{verified}");
        println!(
            "PASS: original-baseline recovery and actual managed browser network verification"
        );
        execute("open", "{}");
        let environment =
            crate::application::runtime::management::observe(&before, "read").unwrap();
        assert!(
            environment["processes"]["web"]["count"]
                .as_u64()
                .unwrap_or(0)
                > 0
        );
        execute("app_stop", r#"{"app":"web"}"#);
        let environment =
            crate::application::runtime::management::observe(&before, "read").unwrap();
        assert_eq!(environment["processes"]["web"]["count"], 0);
        println!("PASS: guarded Web launch and precise managed-browser stop");
        let exited = execute("exit_prepare", r#"{"force":false}"#);
        assert_eq!(exited["stopped"], true, "{exited}");
        assert!(allows_launch(&before).is_err());
        execute("runtime_start", "{}");
        wait_ready();
        let after = crate::application::workbench::load().unwrap().unwrap();
        assert_eq!(before["baseline"], after["baseline"]);
        println!("PASS: safe exit, watchdog restart and immutable formal baseline");
    }
}

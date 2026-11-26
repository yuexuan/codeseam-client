use super::baseline::RECORD;
use super::*;
use crate::infrastructure::vault;
#[test]
#[ignore = "Reads the confirmed environment and browser together without saving or starting applications"]
fn installed_combined_snapshot() {
    let record = load().unwrap().expect("formal baseline");
    let snapshot = read_environment(&record, "read_all").unwrap();
    assert_eq!(snapshot["online"], true, "{}", snapshot["error"]);
    assert!(snapshot["checks"].is_array());
    assert!(snapshot["processes"]["web"]["count"].is_number());
    assert!(
        snapshot["browserData"]["profile"]["profileId"].is_string(),
        "{}",
        snapshot["browserData"]["error"]
    );
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
    std::fs::write(
        path.join("native-observation.json"),
        serde_json::to_vec_pretty(&value).unwrap(),
    )
    .unwrap();
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
        assert!(validate_daily_browser(&native_record)
            .unwrap_err()
            .contains("所选节点"));
        assert_eq!(load().unwrap().unwrap()["baseline"], record["baseline"]);
        native_record["nodeRepair"] = json!({"backup":"RuntimeHistory/pending-node"});
        save(&native_record).unwrap();
        assert!(validate_runtime_start(&native_record).is_ok());
        assert!(validate_daily_browser(&native_record)
            .unwrap_err()
            .contains("节点修复尚未完成"));
        assert_eq!(
            load().unwrap().unwrap()["nodeRepair"],
            native_record["nodeRepair"]
        );
        native_record["reconfiguration"] = json!({"virtualRuntime":true});
        save(&native_record).unwrap();
        assert!(validate_runtime_start(&native_record)
            .unwrap_err()
            .contains("重新配置"));
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

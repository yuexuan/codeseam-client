//! 后台守护与主程序独立写入的加密持久历史。
use crate::infrastructure::vault;
use serde_json::{json, Value};
use std::hash::{Hash, Hasher};
fn event_id(event: &Value) -> String {
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    event.to_string().hash(&mut hash);
    format!("legacy-{:x}", hash.finish())
}
fn iso_millis(value: &str) -> Option<u64> {
    let number = |a, b| value.get(a..b)?.parse::<i64>().ok();
    let mut year = number(0, 4)?;
    let month = number(5, 7)?;
    let day = number(8, 10)?;
    let hour = number(11, 13)?;
    let minute = number(14, 16)?;
    let second = number(17, 19)?;
    if value.get(10..11)? != "T"
        || !(1970..=9999).contains(&year)
        || !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || !(0..=23).contains(&hour)
        || !(0..=59).contains(&minute)
        || !(0..=59).contains(&second)
    {
        return None;
    }
    year -= i64::from(month <= 2);
    let era = year / 400;
    let y = year - era * 400;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let days = era * 146097 + y * 365 + y / 4 - y / 100 + doy - 719468;
    let offset = if value.ends_with('Z') {
        0
    } else {
        let n = value.len();
        let start = n.checked_sub(6)?;
        let sign = match value.get(start..start + 1)? {
            "+" => 1,
            "-" => -1,
            _ => return None,
        };
        sign * (number(n - 5, n - 3)? * 3600 + number(n - 2, n)? * 60)
    };
    u64::try_from((days * 86400 + hour * 3600 + minute * 60 + second - offset) * 1000).ok()
}
fn millis(event: &Value) -> u64 {
    event["epochMs"]
        .as_u64()
        .or_else(|| {
            event["at"].as_str().and_then(|s| {
                s.parse::<u64>()
                    .ok()
                    .map(|n| n.saturating_mul(1000))
                    .or_else(|| iso_millis(s))
            })
        })
        .unwrap_or(0)
}
pub fn archive(record: &mut Value) -> Result<(), String> {
    std::fs::create_dir_all(vault::dir()?.join("GuardianEvents")).map_err(|e| e.to_string())?;
    if let Some(events) = record["events"].as_array_mut() {
        for event in events.iter_mut().filter(|e| e["archived"] != true) {
            if !event["id"].is_string() {
                event["id"] = json!(event_id(event));
            }
            let mut hash = std::collections::hash_map::DefaultHasher::new();
            event["id"].to_string().hash(&mut hash);
            let name = format!(
                "GuardianEvents/event-{:016}-{:x}.dpapi",
                millis(event),
                hash.finish()
            );
            if vault::read(&name)?.is_none() {
                vault::save(
                    &name,
                    &serde_json::to_vec(&vec![event.clone()]).map_err(|e| e.to_string())?,
                )?;
            }
            event["archived"] = json!(true);
        }
        if events.len() > 500 {
            events.drain(..events.len() - 500);
        }
    }
    Ok(())
}
pub fn history(cursor: Option<&str>) -> Result<Value, String> {
    let offset = cursor
        .unwrap_or("0")
        .parse::<usize>()
        .map_err(|_| "事件游标无效")?;
    let directory = vault::dir()?.join("GuardianEvents");
    if !directory.exists() {
        return Ok(json!({"events":[],"cursor":null}));
    }
    // 独立的不可变文件避免后台守护与主程序并发写入冲突。
    // 旧版按日分片仍可读取，不改写或删除已有证据。
    let mut sources = Vec::<(u64, String, Option<Value>)>::new();
    for entry in std::fs::read_dir(directory).map_err(|e| e.to_string())? {
        let name = entry
            .map_err(|e| e.to_string())?
            .file_name()
            .to_string_lossy()
            .into_owned();
        if !name.ends_with(".dpapi") {
            continue;
        }
        if let Some(stamp) = name
            .strip_prefix("event-")
            .and_then(|s| s.split('-').next())
            .and_then(|s| s.parse::<u64>().ok())
        {
            sources.push((stamp, name, None));
        } else if name
            .strip_prefix("events-")
            .and_then(|s| s.strip_suffix(".dpapi"))
            .and_then(|s| s.parse::<u64>().ok())
            .is_some()
        {
            let events: Vec<Value> = serde_json::from_slice(
                &vault::read(&format!("GuardianEvents/{name}"))?.ok_or("事件分片不存在")?,
            )
            .map_err(|e| e.to_string())?;
            for (index, event) in events.into_iter().enumerate() {
                sources.push((millis(&event), format!("{name}-{index:010}"), Some(event)));
            }
        }
    }
    sources.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    let mut skip = offset;
    let mut result = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (_, name, event) in sources {
        let events = match event {
            Some(event) => vec![event],
            None => serde_json::from_slice::<Vec<Value>>(
                &vault::read(&format!("GuardianEvents/{name}"))?.ok_or("事件文件不存在")?,
            )
            .map_err(|e| e.to_string())?,
        };
        for event in events.into_iter().rev() {
            let id = event["id"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| event_id(&event));
            if !seen.insert(id) {
                continue;
            }
            if skip > 0 {
                skip -= 1;
                continue;
            }
            result.push(event);
            if result.len() == 201 {
                break;
            }
        }
        if result.len() == 201 {
            break;
        }
    }
    let cursor = if result.len() > 200 {
        result.pop();
        Some((offset + 200).to_string())
    } else {
        None
    };
    Ok(json!({"events":result,"cursor":cursor}))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn durable_history_is_idempotent_and_bounded_projection_does_not_drop_evidence() {
        let _lock = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
        let root =
            std::env::temp_dir().join(format!("codeseam-guardian-history-{}", std::process::id()));
        let prior = std::env::var_os("CODESEAM_TEST_DATA_DIR");
        std::env::set_var("CODESEAM_TEST_DATA_DIR", &root);
        let outcome = std::panic::catch_unwind(|| {
            assert_eq!(iso_millis("2026-11-25T10:45:10Z"),Some(1795603510000));
            assert_eq!(iso_millis("2026-11-25T18:45:10+08:00"),Some(1795603510000));
            let mut record = json!({"baseline":{"keep":true},"events":(0..501).map(|id|json!({"id":id.to_string(),"at":"100","message":"event","level":"info"})).collect::<Vec<_>>()});
            archive(&mut record).unwrap();
            archive(&mut record).unwrap();
            assert_eq!(record["events"].as_array().unwrap().len(), 500);
            assert_eq!(record["baseline"]["keep"], true);
            let first = history(None).unwrap();
            assert_eq!(first["events"].as_array().unwrap().len(), 200);
            let second = history(first["cursor"].as_str()).unwrap();
            assert_eq!(second["events"].as_array().unwrap().len(), 200);
            let third = history(second["cursor"].as_str()).unwrap();
            assert_eq!(third["events"].as_array().unwrap().len(), 101);
            assert!(third["cursor"].is_null());
            assert!(history(Some("../bad")).is_err());
        });
        match prior {
            Some(v) => std::env::set_var("CODESEAM_TEST_DATA_DIR", v),
            None => std::env::remove_var("CODESEAM_TEST_DATA_DIR"),
        };
        let resolved = root.canonicalize().unwrap();
        assert!(resolved.starts_with(std::env::temp_dir().canonicalize().unwrap()));
        std::fs::remove_dir_all(resolved).unwrap();
        if let Err(error) = outcome {
            std::panic::resume_unwind(error)
        }
    }
}

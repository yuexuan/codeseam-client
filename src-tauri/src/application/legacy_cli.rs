//! Recovery of the existing claude-settings.dpapi contract; no cloud/session dependency.
use crate::infrastructure::vault;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};
const BACKUP: &str = "claude-settings.dpapi";
const FIELDS: &[&str] = &[
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
];

fn load(p: &PathBuf) -> Result<Value, String> {
    if !p.exists() {
        return Ok(json!({}));
    }
    let value: Value = serde_json::from_slice(&fs::read(p).map_err(|e| e.to_string())?)
        .map_err(|_| "Claude settings.json 不是有效 JSON，未覆盖")?;
    if !value.is_object() || value.get("env").is_some_and(|v| !v.is_object()) {
        return Err("Claude 配置结构不支持，未覆盖".into());
    }
    Ok(value)
}
fn write(p: &PathBuf, v: &Value) -> Result<(), String> {
    fs::create_dir_all(p.parent().ok_or("无配置父目录")?).map_err(|e| e.to_string())?;
    let tmp = p.with_extension("codeseam.tmp");
    fs::write(
        &tmp,
        serde_json::to_vec_pretty(v).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(tmp, p).map_err(|e| e.to_string())
}
#[derive(Serialize, Deserialize)]
struct Backup {
    path: PathBuf,
    original: Value,
    existed: bool,
    managed: Value,
}
fn backup() -> Result<Option<Backup>, String> {
    let Some(bytes) = vault::read(BACKUP)? else {
        return Ok(None);
    };
    let backup: Backup =
        serde_json::from_slice(&bytes).map_err(|e| format!("配置备份损坏：{e}"))?;
    let valid_port = backup
        .managed
        .get("ANTHROPIC_BASE_URL")
        .and_then(Value::as_str)
        .and_then(|url| url.strip_prefix("http://127.0.0.1:"))
        .and_then(|url| url.strip_suffix("/claude"))
        .and_then(|port| port.parse::<u16>().ok())
        .is_some_and(|port| port > 0);
    if !backup.path.is_absolute()
        || !backup.original.is_object()
        || backup
            .original
            .get("env")
            .is_some_and(|env| !env.is_object())
        || !backup.managed.is_object()
        || backup.managed.as_object().map(|fields| fields.len()) != Some(2)
        || backup
            .managed
            .get("ANTHROPIC_AUTH_TOKEN")
            .and_then(Value::as_str)
            != Some("codeseam-local-managed")
        || !valid_port
    {
        return Err("不支持的旧配置备份结构，原备份已保留".into());
    }
    Ok(Some(backup))
}

fn matches(v: &Value, b: &Backup) -> bool {
    FIELDS.iter().all(|k| v["env"].get(*k) == b.managed.get(*k))
}

#[derive(Debug, PartialEq, Eq)]
pub enum RecoveryState {
    Clean,
    Pending,
    Restored,
    Conflict,
}

fn original_fields_match(value: &Value, backup: &Backup) -> bool {
    FIELDS
        .iter()
        .all(|key| value["env"].get(*key) == backup.original["env"].get(*key))
}

pub fn inspect() -> Result<RecoveryState, String> {
    let Some(backup) = backup()? else {
        return Ok(RecoveryState::Clean);
    };
    let value = load(&backup.path)?;
    if original_fields_match(&value, &backup) {
        return Ok(RecoveryState::Restored);
    }
    if matches(&value, &backup) {
        return Ok(RecoveryState::Pending);
    }
    Ok(RecoveryState::Conflict)
}
pub fn restore() -> Result<(), String> {
    let Some(b) = backup()? else { return Ok(()) };
    let mut v = load(&b.path)?;
    // A crash after settings replacement but before backup deletion is resumable.
    if original_fields_match(&v, &b) {
        return vault::remove(BACKUP);
    }
    if !matches(&v, &b) {
        return Err("CLI 受管字段已变更，未覆盖；加密备份仍保留".into());
    }
    let env = v["env"].as_object_mut().ok_or("env 无效")?;
    for k in FIELDS {
        env.remove(*k);
        if let Some(val) = b.original["env"].get(*k) {
            env.insert(k.to_string(), val.clone());
        }
    }
    if env.is_empty() && b.original.get("env").is_none() {
        v.as_object_mut().unwrap().remove("env");
    }
    if !b.existed && v == json!({}) {
        fs::remove_file(&b.path).map_err(|e| e.to_string())?;
    } else {
        write(&b.path, &v)?;
    }
    vault::remove(BACKUP)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn existing_backup_recovery_conflict_and_interruption() {
        let _lock = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
        let root = std::env::temp_dir().join(format!(
            "codeseam-recovery-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let previous = std::env::var_os("CODESEAM_TEST_DATA_DIR");
        std::env::set_var("CODESEAM_TEST_DATA_DIR", &root);
        let result = std::panic::catch_unwind(|| {
            let path = root.join("settings.json");
            let original = json!({"env":{"ANTHROPIC_API_KEY":"original", "OTHER":"keep"}});
            let managed = json!({"ANTHROPIC_BASE_URL":"http://127.0.0.1:18899/claude", "ANTHROPIC_AUTH_TOKEN":"codeseam-local-managed"});
            let backup = Backup {
                path: path.clone(),
                original: original.clone(),
                existed: true,
                managed: managed.clone(),
            };
            let persist = || vault::save(BACKUP, &serde_json::to_vec(&backup).unwrap()).unwrap();
            let value = json!({"env": managed, "permissions":{"deny":["Bash(rm:*)"]}});
            write(&path, &value).unwrap();
            persist();
            assert_eq!(inspect().unwrap(), RecoveryState::Pending);
            restore().unwrap();
            let restored = load(&path).unwrap();
            assert_eq!(restored["env"]["ANTHROPIC_API_KEY"], "original");
            assert_eq!(restored["permissions"], value["permissions"]);
            assert_eq!(inspect().unwrap(), RecoveryState::Clean);

            // Simulate interruption after writing settings and before removing backup.
            persist();
            assert_eq!(inspect().unwrap(), RecoveryState::Restored);
            restore().unwrap();
            assert_eq!(load(&path).unwrap(), restored);

            write(&path, &json!({"env":{"ANTHROPIC_API_KEY":"external"}})).unwrap();
            persist();
            let before = fs::read(&path).unwrap();
            assert_eq!(inspect().unwrap(), RecoveryState::Conflict);
            assert!(restore().is_err());
            assert_eq!(fs::read(&path).unwrap(), before);
            assert!(vault::read(BACKUP).unwrap().is_some());

            vault::save(
                BACKUP,
                br#"{"path":"C:/settings.json","original":[],"existed":true,"managed":{}}"#,
            )
            .unwrap();
            assert!(inspect().is_err());
            assert!(restore().is_err());
            assert_eq!(fs::read(&path).unwrap(), before);
            vault::save(BACKUP, b"invalid-json").unwrap();
            assert!(inspect().is_err());
            assert!(restore().is_err());
            assert_eq!(fs::read(&path).unwrap(), before);
            assert!(vault::read(BACKUP).unwrap().is_some());
        });
        match previous {
            Some(value) => std::env::set_var("CODESEAM_TEST_DATA_DIR", value),
            None => std::env::remove_var("CODESEAM_TEST_DATA_DIR"),
        }
        fs::remove_dir_all(root).unwrap();
        if let Err(panic) = result {
            std::panic::resume_unwind(panic);
        }
    }
}

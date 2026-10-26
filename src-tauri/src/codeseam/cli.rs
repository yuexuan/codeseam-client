use super::vault;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, process::Command};

const BACKUP: &str = "claude-settings.dpapi";
pub const TOKEN: &str = "codeseam-local-managed";
const FIELDS: &[&str] = &[
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
];

fn path() -> Result<PathBuf, String> {
    let root = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|p| p.join(".claude")))
        .ok_or("找不到 Claude 配置目录")?;
    Ok(root.join("settings.json"))
}
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
    vault::read(BACKUP)?
        .map(|b| serde_json::from_slice(&b).map_err(|_| "配置备份损坏".into()))
        .transpose()
}
fn matches(v: &Value, b: &Backup) -> bool {
    FIELDS.iter().all(|k| v["env"].get(*k) == b.managed.get(*k))
}

pub fn configured(port: u16) -> bool {
    path()
        .and_then(|p| load(&p))
        .map(|v| {
            v["env"]["ANTHROPIC_BASE_URL"] == format!("http://127.0.0.1:{port}/claude")
                && v["env"]["ANTHROPIC_AUTH_TOKEN"] == TOKEN
                && v["env"].get("ANTHROPIC_API_KEY").is_none()
        })
        .unwrap_or(false)
}
pub fn configure(port: u16) -> Result<(), String> {
    let p = path()?;
    let mut v = load(&p)?;
    let managed = json!({"ANTHROPIC_BASE_URL":format!("http://127.0.0.1:{port}/claude"),"ANTHROPIC_AUTH_TOKEN":TOKEN});
    if let Some(b) = backup()? {
        if b.path != p || !matches(&v, &b) {
            return Err("CLI 受管字段已被修改，请先恢复或手工检查；未覆盖".into());
        }
        if b.managed != managed {
            return Err("请先恢复原配置再变更端口".into());
        }
        return Ok(());
    }
    let b = Backup {
        path: p.clone(),
        original: v.clone(),
        existed: p.exists(),
        managed: managed.clone(),
    };
    vault::save(BACKUP, &serde_json::to_vec(&b).map_err(|e| e.to_string())?)?;
    let obj = v.as_object_mut().ok_or("无效配置")?;
    let env = obj
        .entry("env")
        .or_insert(json!({}))
        .as_object_mut()
        .ok_or("env 无效")?;
    for k in FIELDS {
        env.remove(*k);
    }
    for (k, val) in managed.as_object().unwrap() {
        env.insert(k.clone(), val.clone());
    }
    if let Err(e) = write(&p, &v) {
        vault::remove(BACKUP)?;
        return Err(e);
    }
    Ok(())
}
pub fn restore() -> Result<(), String> {
    let Some(b) = backup()? else { return Ok(()) };
    let mut v = load(&b.path)?;
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
pub fn detect() -> Option<String> {
    let out = hidden("where.exe").arg("claude").output().ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .find(|s| s.ends_with(".exe") || s.ends_with(".cmd"))
        .map(str::to_owned)
}
pub fn hidden(program: &str) -> Command {
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000);
    }
    c
}
pub fn launch(port: u16, assigned_proxy: Option<&str>) -> Result<std::process::Child, String> {
    if !configured(port) {
        return Err("请先确认配置 localhost；配置漂移时禁止启动".into());
    }
    let assigned_proxy = assigned_proxy.ok_or("缺少受管代理，已拒绝启动以避免直连降级")?;
    let exe = detect().ok_or("未检测到 Claude Code，请先安装官方 CLI")?;
    // Launch a visible terminal only for the CLI the user explicitly starts.
    let mut c = Command::new("powershell.exe");
    c.args([
        "-NoProfile",
        "-NoExit",
        "-Command",
        &format!("& '{}'", exe.replace('\'', "''")),
    ]);
    for name in [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
        "NO_PROXY",
        "no_proxy",
    ] {
        c.env_remove(name);
    }
    c.env(
        "ANTHROPIC_BASE_URL",
        format!("http://127.0.0.1:{port}/claude"),
    )
    .env("ANTHROPIC_AUTH_TOKEN", TOKEN)
    // Best-effort process path for non-API requests. This is deliberately not
    // reported as network-layer protection; a Windows WFP/TUN rule is still
    // needed before that surface can be called fully covered.
    .env("HTTP_PROXY", assigned_proxy)
    .env("HTTPS_PROXY", assigned_proxy)
    .env("ALL_PROXY", assigned_proxy)
    .env("NO_PROXY", "127.0.0.1,localhost,[::1]");
    c.spawn().map_err(|e| format!("启动 Claude 失败：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detects_drift_without_touching_unrelated_settings() {
        let managed = json!({"ANTHROPIC_BASE_URL":"http://127.0.0.1:18899/claude","ANTHROPIC_AUTH_TOKEN":TOKEN});
        let b = Backup {
            path: PathBuf::new(),
            original: json!({}),
            existed: false,
            managed: managed.clone(),
        };
        let mut v = json!({"env":managed,"permissions":{"deny":["Bash(rm:*)"]}});
        assert!(matches(&v, &b));
        v["env"]["ANTHROPIC_API_KEY"] = json!("external");
        assert!(!matches(&v, &b));
    }

    #[cfg(windows)]
    #[test]
    fn configure_and_restore_round_trip_preserves_unmanaged_fields() {
        let _lock = crate::config::TEST_HOME_LOCK.lock().unwrap();
        let root = std::env::temp_dir().join(format!(
            "codeseam-cli-restore-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let config_dir = root.join("claude");
        let data_dir = root.join("data");
        fs::create_dir_all(&config_dir).unwrap();
        let config_path = config_dir.join("settings.json");
        fs::write(
            &config_path,
            br#"{"env":{"ANTHROPIC_API_KEY":"original-key","OTHER":"keep"},"permissions":{"deny":["Bash(rm:*)"]}}"#,
        )
        .unwrap();
        let old_config = std::env::var_os("CLAUDE_CONFIG_DIR");
        let old_data = std::env::var_os("CODESEAM_TEST_DATA_DIR");
        std::env::set_var("CLAUDE_CONFIG_DIR", &config_dir);
        std::env::set_var("CODESEAM_TEST_DATA_DIR", &data_dir);
        let result = (|| {
            configure(18899)?;
            let managed: Value = serde_json::from_slice(&fs::read(&config_path).unwrap()).unwrap();
            assert_eq!(managed["env"]["ANTHROPIC_AUTH_TOKEN"], TOKEN);
            assert_eq!(managed["env"]["OTHER"], "keep");
            restore()?;
            let restored: Value = serde_json::from_slice(&fs::read(&config_path).unwrap()).unwrap();
            assert_eq!(restored["env"]["ANTHROPIC_API_KEY"], "original-key");
            assert_eq!(restored["env"]["OTHER"], "keep");
            Ok::<(), String>(())
        })();
        match old_config {
            Some(value) => std::env::set_var("CLAUDE_CONFIG_DIR", value),
            None => std::env::remove_var("CLAUDE_CONFIG_DIR"),
        }
        match old_data {
            Some(value) => std::env::set_var("CODESEAM_TEST_DATA_DIR", value),
            None => std::env::remove_var("CODESEAM_TEST_DATA_DIR"),
        }
        let _ = fs::remove_dir_all(root);
        result.unwrap();
    }
}

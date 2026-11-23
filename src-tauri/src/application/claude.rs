use crate::infrastructure::vault;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
const BACKUP: &str = "claude-cleanup.dpapi";
#[derive(Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CleanupItem {
    pub id: String,
    pub label: String,
    pub detail: String,
}
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CleanupReport {
    pub items: Vec<CleanupItem>,
    pub code_installed: bool,
    pub desktop_installed: bool,
    pub can_restore: bool,
    pub warnings: Vec<String>,
}
#[derive(Serialize, Deserialize)]
struct Entry {
    path: PathBuf,
    before: Vec<u8>,
    after: Vec<u8>,
}
const ENV_TARGET: &str = "__claude_user_environment__";
fn env_read() -> Result<Vec<u8>, String> {
    let script = r#"$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
$rows=@(foreach($n in @('ANTHROPIC_BASE_URL','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_CUSTOM_HEADERS','CLAUDE_CODE_PROXY_URL')) {
 if($k -and $k.GetValueNames() -contains $n) { [ordered]@{name=$n;value=$k.GetValue($n,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);kind=$k.GetValueKind($n).ToString()} }
})
if($k){$k.Dispose()}
ConvertTo-Json -InputObject $rows -Compress -Depth 8
"#;
    let value: Value = crate::infrastructure::windows::run_script(script.as_bytes())
        .map_err(|_| "无法读取 Claude 用户级环境变量")?;
    serde_json::to_vec(&value).map_err(|e| e.to_string())
}
fn read_target(path: &Path) -> Result<Vec<u8>, String> {
    if path == Path::new(ENV_TARGET) {
        env_read()
    } else {
        fs::read(path).map_err(|_| "无法读取 Claude 配置".into())
    }
}
fn write_target(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if path != Path::new(ENV_TARGET) {
        let tmp = path.with_extension("codeseam-cleanup.tmp");
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(|_| "无法创建配置临时文件，备份保留")?;
        let result = (|| {
            file.write_all(bytes).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            drop(file);
            fs::rename(&tmp, path).map_err(|e| e.to_string())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        return result;
    }
    let json = String::from_utf8(bytes.to_vec())
        .map_err(|e| e.to_string())?
        .replace("'", "''");
    let script = format!(
        r#"$ErrorActionPreference='Stop'
$rows=ConvertFrom-Json -InputObject '{json}'
$k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
foreach($n in @('ANTHROPIC_BASE_URL','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_CUSTOM_HEADERS','CLAUDE_CODE_PROXY_URL')) {{ $k.DeleteValue($n,$false) }}
foreach($r in $rows) {{ $k.SetValue($r.name,$r.value,([Enum]::Parse([Microsoft.Win32.RegistryValueKind],$r.kind))) }}
$k.Dispose()
Write-Output 'true'
"#
    );
    let _: bool = crate::infrastructure::windows::run_script(script.as_bytes())
        .map_err(|_| "环境变量写入失败，备份保留，请恢复")?;
    let rows: Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    for name in [
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_CUSTOM_HEADERS",
        "CLAUDE_CODE_PROXY_URL",
    ] {
        match rows
            .as_array()
            .and_then(|rows| rows.iter().find(|r| r["name"] == name))
            .and_then(|r| r["value"].as_str())
        {
            Some(value) => std::env::set_var(name, value),
            None => std::env::remove_var(name),
        }
    }
    Ok(())
}
fn targets() -> Result<Vec<(String, PathBuf)>, String> {
    #[cfg(test)]
    if let Some(root) = std::env::var_os("CODESEAM_CLAUDE_TEST_DIR") {
        let root = PathBuf::from(root);
        return Ok(vec![
            ("code".into(), root.join("settings.json")),
            ("desktop".into(), root.join("desktop.json")),
        ]);
    }
    let home = dirs::home_dir().ok_or("找不到用户目录")?;
    let roaming = dirs::config_dir().ok_or("找不到应用配置目录")?;
    Ok(vec![
        ("env".into(), PathBuf::from(ENV_TARGET)),
        ("code".into(), home.join(".claude/settings.json")),
        (
            "desktop".into(),
            roaming.join("Claude/claude_desktop_config.json"),
        ),
    ])
}
fn cleaned(mut value: Value, id: &str) -> Value {
    if id == "env" {
        return serde_json::json!([]);
    }
    if id == "code" {
        if let Some(env) = value.get_mut("env").and_then(Value::as_object_mut) {
            for key in [
                "ANTHROPIC_BASE_URL",
                "ANTHROPIC_API_KEY",
                "ANTHROPIC_AUTH_TOKEN",
                "ANTHROPIC_CUSTOM_HEADERS",
                "HTTP_PROXY",
                "HTTPS_PROXY",
                "ALL_PROXY",
                "NO_PROXY",
                "http_proxy",
                "https_proxy",
                "all_proxy",
                "no_proxy",
            ] {
                env.remove(key);
            }
        }
    } else if let Some(obj) = value.as_object_mut() {
        for key in ["proxy", "proxyUrl", "httpProxy", "httpsProxy"] {
            obj.remove(key);
        }
    }
    value
}
pub fn read() -> Result<CleanupReport, String> {
    let targets = targets()?;
    let mut items = Vec::new();
    let mut warnings = Vec::new();
    for (id, path) in &targets {
        if path.exists() || id == "env" {
            let value: Value = match read_target(path).and_then(|bytes| {
                serde_json::from_slice(&bytes).map_err(|_| "配置不是有效 JSON".into())
            }) {
                Ok(value) => value,
                Err(_) => {
                    warnings.push(format!(
                        "{}：无法读取或解析，未作修改；可修复后重新扫描，也可跳过。",
                        if id == "env" {
                            "Claude 用户变量"
                        } else {
                            id
                        }
                    ));
                    continue;
                }
            };
            if cleaned(value.clone(), id) != value {
                items.push(CleanupItem {
                    id: id.clone(),
                    label: if id == "env" {
                        "Claude Code · 代理环境变量".into()
                    } else if id == "code" {
                        "Claude Code · 旧连接与代理变量".into()
                    } else {
                        "Claude Desktop · 旧网络设置".into()
                    },
                    detail: if id == "env" {
                        "Claude 专属变量 · 用户级（保留系统通用代理）".into()
                    } else {
                        path.display().to_string()
                    },
                });
            }
        }
    }
    let code_installed = crate::infrastructure::windows::hidden("where.exe")
        .arg("claude")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    let desktop_installed = dirs::data_local_dir()
        .map(|p| {
            p.join("AnthropicClaude").exists() || p.join("Programs/Claude/Claude.exe").exists()
        })
        .unwrap_or(false);
    Ok(CleanupReport {
        items,
        code_installed,
        desktop_installed,
        can_restore: vault::read(BACKUP)?.is_some(),
        warnings,
    })
}
pub fn clean(ids: Vec<String>) -> Result<CleanupReport, String> {
    if ids.is_empty()
        || ids
            .iter()
            .any(|id| id != "code" && id != "desktop" && id != "env")
    {
        return Err("请选择有效配置".into());
    }
    let mut entries: Vec<Entry> = match vault::read(BACKUP)? {
        Some(bytes) => serde_json::from_slice(&bytes).map_err(|_| "备份损坏，停止清理")?,
        None => Vec::new(),
    };
    let previous = entries.len();
    for (id, path) in targets()? {
        if !ids.contains(&id) || (!path.exists() && id != "env") {
            continue;
        }
        let before = read_target(&path)?;
        let value: Value =
            serde_json::from_slice(&before).map_err(|_| "配置 JSON 无效，未执行清理")?;
        let after_value = cleaned(value.clone(), &id);
        if value != after_value {
            if entries.iter().any(|entry| entry.path == path) {
                return Err("此配置已有备份且发生变化，请先恢复".into());
            }
            entries.push(Entry {
                path,
                before,
                after: if id == "env" {
                    serde_json::to_vec(&after_value)
                } else {
                    serde_json::to_vec_pretty(&after_value)
                }
                .map_err(|e| e.to_string())?,
            });
        }
    }
    if entries.len() == previous {
        return read();
    }
    let bytes = serde_json::to_vec(&entries).map_err(|e| e.to_string())?;
    vault::save(BACKUP, &bytes)?;
    if vault::read(BACKUP)?.as_deref() != Some(bytes.as_slice()) {
        return Err("备份校验失败，未清理".into());
    }
    for entry in &entries[previous..] {
        if read_target(&entry.path)? != entry.before {
            return Err("配置已被其他程序修改；备份已保留，请重新扫描".into());
        }
        write_target(&entry.path, &entry.after)?;
        if read_target(&entry.path)? != entry.after {
            return Err("清理复验失败，请恢复备份".into());
        }
    }
    read()
}
pub fn restore() -> Result<CleanupReport, String> {
    let bytes = vault::read(BACKUP)?.ok_or("没有可恢复的备份")?;
    let entries: Vec<Entry> = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    for entry in &entries {
        let current = read_target(&entry.path)?;
        let partial_env = entry.path == Path::new(ENV_TARGET) && {
            let original: Value =
                serde_json::from_slice(&entry.before).map_err(|e| e.to_string())?;
            let current_value: Value =
                serde_json::from_slice(&current).map_err(|e| e.to_string())?;
            current_value
                .as_array()
                .map(|rows| {
                    rows.iter().all(|row| {
                        original
                            .as_array()
                            .is_some_and(|before| before.contains(row))
                    })
                })
                .unwrap_or(false)
        };
        if current != entry.after && current != entry.before && !partial_env {
            return Err("清理后配置发生变化，为避免覆盖新设置，恢复已停止，备份保留".into());
        }
    }
    for entry in &entries {
        write_target(&entry.path, &entry.before)?;
        if read_target(&entry.path)? != entry.before {
            return Err("恢复复验失败，备份保留".into());
        }
    }
    vault::remove(BACKUP)?;
    read()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_history_and_unrelated_settings() {
        let value = serde_json::json!({"env":{"ANTHROPIC_BASE_URL":"secret","HTTPS_PROXY":"secret","OTHER":"keep"},"permissions":{"allow":["Read"]},"history":[1]});
        let result = cleaned(value.clone(), "code");
        assert_eq!(result["history"], value["history"]);
        assert_eq!(result["permissions"], value["permissions"]);
        assert_eq!(result["env"], serde_json::json!({"OTHER":"keep"}));
    }
    #[test]
    fn desktop_preserves_mcp_servers() {
        let result = cleaned(
            serde_json::json!({"proxy":"secret","mcpServers":{"test":{}}}),
            "desktop",
        );
        assert!(result.get("proxy").is_none());
        assert!(result.get("mcpServers").is_some());
    }
    #[cfg(windows)]
    #[test]
    fn encrypted_cleanup_restore_and_conflict_guard() {
        let _lock = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
        let root = std::env::temp_dir().join(format!("codeseam-claude-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        std::env::set_var("CODESEAM_CLAUDE_TEST_DIR", &root);
        std::env::set_var("CODESEAM_TEST_DATA_DIR", root.join("vault"));
        let path = root.join("settings.json");
        let original = br#"{"env":{"ANTHROPIC_BASE_URL":"private-endpoint"},"history":["keep"]}"#;
        fs::write(&path, original).unwrap();
        assert_eq!(read().unwrap().items.len(), 1);
        let report = clean(vec!["code".into()]).unwrap();
        assert!(report.items.is_empty());
        assert!(report.can_restore);
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(&path).unwrap()).unwrap()["history"],
            serde_json::json!(["keep"])
        );
        let ciphertext = fs::read(root.join("vault/CodeSeam").join(BACKUP)).unwrap();
        assert!(!ciphertext.windows(16).any(|w| w == b"private-endpoint"));
        let cleaned = fs::read(&path).unwrap();
        fs::write(&path, b"{}").unwrap();
        assert!(restore().is_err());
        assert_eq!(fs::read(&path).unwrap(), b"{}");
        fs::write(&path, cleaned).unwrap();
        assert!(!restore().unwrap().can_restore);
        assert_eq!(fs::read(&path).unwrap(), original);
        std::env::remove_var("CODESEAM_CLAUDE_TEST_DIR");
        std::env::remove_var("CODESEAM_TEST_DATA_DIR");
        fs::remove_dir_all(root).unwrap();
    }
}

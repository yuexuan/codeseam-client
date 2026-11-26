use super::powershell;
use serde_json::Value;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

pub(crate) const ENV_TARGET: &str = "__claude_user_environment__";
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
    let value: Value =
        powershell::run_script(script.as_bytes()).map_err(|_| "无法读取 Claude 用户级环境变量")?;
    serde_json::to_vec(&value).map_err(|e| e.to_string())
}
pub(crate) fn read_target(path: &Path) -> Result<Vec<u8>, String> {
    if path == Path::new(ENV_TARGET) {
        env_read()
    } else {
        fs::read(path).map_err(|_| "无法读取 Claude 配置".into())
    }
}
pub(crate) fn write_target(path: &Path, bytes: &[u8]) -> Result<(), String> {
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
    let _: bool = powershell::run_script(script.as_bytes())
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
pub(crate) fn targets() -> Result<Vec<(String, PathBuf)>, String> {
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
pub(crate) fn installed() -> (bool, bool) {
    let code_installed = super::managed_process::hidden("where.exe")
        .arg("claude")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    let desktop_installed = dirs::data_local_dir()
        .map(|p| {
            p.join("AnthropicClaude").exists() || p.join("Programs/Claude/Claude.exe").exists()
        })
        .unwrap_or(false);
    (code_installed, desktop_installed)
}

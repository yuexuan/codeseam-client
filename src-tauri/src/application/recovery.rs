use super::legacy_cli::{self, RecoveryState};
use crate::{
    domain::{RecoveryAction, RecoveryItem},
    infrastructure::vault,
};
fn item(message: String, action: Option<RecoveryAction>) -> RecoveryItem {
    RecoveryItem { message, action }
}
pub fn inventory() -> Result<Vec<RecoveryItem>, String> {
    let mut pending = Vec::new();
    match legacy_cli::inspect()? {
        RecoveryState::Clean => {}
        RecoveryState::Pending => pending.push(item(
            "Claude Code 有待恢复的受管配置".into(),
            Some(RecoveryAction::Cli),
        )),
        RecoveryState::Restored => pending.push(item(
            "Claude Code 已恢复，备份待确认收尾".into(),
            Some(RecoveryAction::Cli),
        )),
        RecoveryState::Conflict => pending.push(item(
            "Claude Code 受管字段与备份冲突，禁止覆盖".into(),
            None,
        )),
    }
    let dir = vault::dir()?;
    for (file, label, action) in [
        (
            "system-ipv6-backup.dpapi",
            "系统 IPv6",
            RecoveryAction::Ipv6,
        ),
        ("system-dns-backup.dpapi", "系统 DNS", RecoveryAction::Dns),
    ] {
        if dir.join(file).exists() {
            pending.push(item(
                format!("{label} 存在旧受管备份，需要确认恢复"),
                Some(action),
            ));
        }
    }
    // Older upstream snapshots lack an applied-field journal: never invent ownership.
    let home = dirs::home_dir().ok_or("无法读取用户目录")?;
    if home.join(".z-switch/original/manifest.json").exists() {
        pending.push(item(
            "发现旧供应商配置快照；缺少逐字段应用日志，需人工核对，未自动覆盖".into(),
            None,
        ));
    }
    let local = dirs::data_local_dir().ok_or("无法读取本地数据目录")?;
    for entry in std::fs::read_dir(&local).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_name().to_string_lossy().starts_with("Claude")
            && entry
                .path()
                .join("configLibrary/00000000-0000-4000-8000-007a53000001.json")
                .exists()
        {
            pending.push(item(
                "发现旧 Desktop 网关配置；没有持久化原值备份，需人工核对恢复，未自动改成官方模式"
                    .into(),
                None,
            ));
        }
    }
    let plugin = home.join(".claude/config.json");
    if plugin.exists() {
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&plugin).map_err(|e| e.to_string())?)
                .map_err(|e| format!("Claude 插件配置无法解析：{e}"))?;
        if value
            .get("primaryApiKey")
            .and_then(serde_json::Value::as_str)
            == Some("any")
        {
            pending.push(item(
                "发现旧插件标记；无法单凭值确认归属，不自动删除用户配置".into(),
                None,
            ));
        }
    }
    Ok(pending)
}
pub fn restore_cli() -> Result<(), String> {
    legacy_cli::restore()
}
pub fn finish_legacy_session() -> Result<(), String> {
    if !inventory()?.is_empty() {
        return Err("仍存在待恢复或冲突记录，旧会话与备份已保留".into());
    }
    vault::remove("session.dpapi")
}

#[cfg(test)]
mod tests {
    #[test]
    fn unresolved_network_backup_prevents_session_cleanup() {
        let _lock = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
        let root = std::env::temp_dir().join(format!("codeseam-uninstall-{}", std::process::id()));
        let prior = std::env::var_os("CODESEAM_TEST_DATA_DIR");
        std::env::set_var("CODESEAM_TEST_DATA_DIR", &root);
        let result = std::panic::catch_unwind(|| {
            super::vault::save("session.dpapi", b"legacy-test-session").unwrap();
            super::vault::save("system-dns-backup.dpapi", b"retained-test-backup").unwrap();
            assert!(super::finish_legacy_session().is_err());
            assert_eq!(
                super::vault::read("session.dpapi").unwrap().unwrap(),
                b"legacy-test-session"
            );
            assert_eq!(
                super::vault::read("system-dns-backup.dpapi")
                    .unwrap()
                    .unwrap(),
                b"retained-test-backup"
            );
        });
        match prior {
            Some(v) => std::env::set_var("CODESEAM_TEST_DATA_DIR", v),
            None => std::env::remove_var("CODESEAM_TEST_DATA_DIR"),
        };
        std::fs::remove_dir_all(root).unwrap();
        if let Err(p) = result {
            std::panic::resume_unwind(p);
        }
    }
}

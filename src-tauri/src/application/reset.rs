//! 仅重置 CodeSeam 自有资源；最后才移除初始化记录。
use crate::infrastructure::{network_recovery, vault, windows};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    fs,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub fn execute(input: Value) -> Result<String, String> {
    let local = input["local"].as_bool().ok_or("缺少本地环境选择")?;
    let virtual_runtime = input["virtual"].as_bool().ok_or("缺少虚拟环境选择")?;
    let keep = input["keepBackup"].as_bool().ok_or("请明确是否保留备份")?;
    if !local && !virtual_runtime {
        return Err("请至少选择一个环境".into());
    }
    let root = vault::dir()?;
    // 创建或复制备份目录前，先拒绝处理目录联接。
    #[cfg(windows)]
    for path in [root.clone(), root.join("ResetBackups")] {
        use std::os::windows::fs::MetadataExt;
        if let Ok(meta) = fs::symlink_metadata(&path) {
            if meta.file_attributes() & 0x400 != 0 {
                return Err("重置数据或备份目录不可为链接".into());
            }
        }
    }
    let backup = if keep {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let path = root.join("ResetBackups").join(id.to_string());
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        // 密文始终以密文形式保留，包括恢复前的证据。
        for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_type().map_err(|e| e.to_string())?.is_file() {
                fs::copy(entry.path(), path.join(entry.file_name())).map_err(|e| e.to_string())?;
            }
        }
        Some(path)
    } else {
        None
    };
    let result = (|| -> Result<(), String> {
        let request = json!({"root":root,"local":local,"virtual":virtual_runtime,"backup":backup,"desktop":dirs::desktop_dir()});
        let script = format!("$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}')) | ConvertFrom-Json\n{}", STANDARD.encode(request.to_string()), include_str!("../infrastructure/reset.ps1"));
        let _: Value =
            windows::run_script_with_timeout(script.as_bytes(), Duration::from_secs(3600))?;
        if local {
            for (file, action) in [
                ("system-time-sync-backup.dpapi", "enable_time_sync"),
                ("system-ipv6-backup.dpapi", "disable_ipv6"),
                ("system-timezone-backup.dpapi", "set_timezone"),
                ("system-dns-backup.dpapi", "set_dns"),
            ] {
                if root.join(file).exists() {
                    network_recovery::restore(action)?;
                }
            }
            // 仅恢复本应用清理过的字段，并遵守冲突检查结果。
            if root.join("claude-cleanup.dpapi").exists() {
                super::claude::restore()?;
            }
            vault::remove("runtime-v1.dpapi")?;
        }
        if virtual_runtime {
            vault::remove("virtual-node-v1.dpapi")?;
        }
        vault::remove("initialization.json")?;
        // 移除正式记录是返回向导的最终提交点。
        vault::remove("workbench-v1.dpapi")?;
        Ok(())
    })();
    result.map_err(|e| {
        format!(
            "重置未完成：{e}。可修复后重试；{}",
            backup
                .as_ref()
                .map(|p| format!("备份保存在 {}", p.display()))
                .unwrap_or_else(|| "未请求创建备份，尚未完成的恢复记录仍保留".into())
        )
    })?;
    Ok(json!({"backupPath":backup,"completed":true}).to_string())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn reset_backs_up_selected_resources_and_reenters_initialization() {
        let _guard = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
        let home = std::env::temp_dir().join(format!(
            "codeseam-reset-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let prior = std::env::var_os("CODESEAM_TEST_DATA_DIR");
        std::env::set_var("CODESEAM_TEST_DATA_DIR", &home);
        let outcome = std::panic::catch_unwind(|| {
            let root = vault::dir().unwrap();
            fs::create_dir_all(root.join("Browser/native/edge/User Data")).unwrap();
            fs::write(
                root.join("Browser/native/edge/User Data/Cookies"),
                b"fixture cookie",
            )
            .unwrap();
            fs::create_dir_all(root.join("Virtual/Images")).unwrap();
            fs::write(root.join("Virtual/Images/input.iso"), b"image fixture").unwrap();
            vault::save("workbench-v1.dpapi", b"formal fixture").unwrap();
            vault::save("runtime-v1.dpapi", b"runtime fixture").unwrap();
            vault::save("virtual-node-v1.dpapi", b"virtual fixture").unwrap();
            vault::save("proxy-nodes-v1.dpapi", b"private nodes").unwrap();
            fs::write(root.join("initialization.json"), b"checkpoint").unwrap();
            assert!(execute(json!({"local":false,"virtual":false,"keepBackup":true})).is_err());
            assert!(root.join("workbench-v1.dpapi").exists());
            fs::write(root.join("ResetBackups"), b"blocked backup destination").unwrap();
            assert!(execute(json!({"local":true,"virtual":false,"keepBackup":true})).is_err());
            assert!(root.join("workbench-v1.dpapi").exists());
            assert!(root.join("Browser/native/edge/User Data/Cookies").exists());
            fs::remove_file(root.join("ResetBackups")).unwrap();
            let result: Value = serde_json::from_str(
                &execute(json!({"local":true,"virtual":false,"keepBackup":true})).unwrap(),
            )
            .unwrap();
            let backup = std::path::PathBuf::from(result["backupPath"].as_str().unwrap());
            assert_eq!(
                fs::read(backup.join("native/edge/User Data/Cookies")).unwrap(),
                b"fixture cookie"
            );
            assert_eq!(
                fs::read(backup.join("proxy-nodes-v1.dpapi")).unwrap(),
                fs::read(root.join("proxy-nodes-v1.dpapi")).unwrap()
            );
            assert!(!root.join("Browser/native").exists());
            assert!(!root.join("runtime-v1.dpapi").exists());
            assert_eq!(
                super::super::workbench::execute("read".into(), "{}".into()).unwrap(),
                "null"
            );
            assert!(matches!(
                super::super::state::load().unwrap().scan_phase,
                crate::domain::ScanPhase::NotStarted
            ));
            assert!(root.join("virtual-node-v1.dpapi").exists());
            execute(json!({"local":false,"virtual":true,"keepBackup":false})).unwrap();
            assert!(!root.join("virtual-node-v1.dpapi").exists());
            assert!(root.join("Virtual/Images/input.iso").exists());
            assert!(backup.exists());
        });
        match prior {
            Some(value) => std::env::set_var("CODESEAM_TEST_DATA_DIR", value),
            None => std::env::remove_var("CODESEAM_TEST_DATA_DIR"),
        }
        let resolved = home.canonicalize().unwrap();
        assert!(resolved.starts_with(std::env::temp_dir().canonicalize().unwrap()));
        fs::remove_dir_all(resolved).unwrap();
        if let Err(panic) = outcome {
            std::panic::resume_unwind(panic);
        }
    }
}

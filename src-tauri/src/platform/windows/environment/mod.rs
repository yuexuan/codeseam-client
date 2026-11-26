use super::powershell;
use crate::domain::Check;
use serde_json::Value;
use std::{fs, path::Path, time::Duration};

pub fn scan() -> Result<Vec<Check>, String> {
    powershell::run_script(include_bytes!("preflight.ps1"))
}

pub(crate) fn check_reset_directories(root: &Path) -> Result<(), String> {
    #[cfg(windows)]
    for path in [root.to_path_buf(), root.join("ResetBackups")] {
        use std::os::windows::fs::MetadataExt;
        if let Ok(meta) = fs::symlink_metadata(&path) {
            if meta.file_attributes() & 0x400 != 0 {
                return Err("重置数据或备份目录不可为链接".into());
            }
        }
    }
    Ok(())
}

pub(crate) fn reset(request: &Value) -> Result<(), String> {
    let _: Value = powershell::request(
        include_str!("reset.ps1"),
        request,
        Duration::from_secs(3600),
    )?;
    Ok(())
}

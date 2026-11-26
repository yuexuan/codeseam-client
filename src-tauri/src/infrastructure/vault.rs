use crate::platform::credentials::crypt;
use std::{fs, path::PathBuf};

pub fn dir() -> Result<PathBuf, String> {
    #[cfg(test)]
    let root = std::env::var_os("CODESEAM_TEST_DATA_DIR")
        .map(PathBuf::from)
        .or_else(dirs::data_local_dir);
    #[cfg(not(test))]
    let root = dirs::data_local_dir();
    let p = root.ok_or("找不到用户数据目录")?.join("CodeSeam");
    fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(p)
}

pub fn save(name: &str, bytes: &[u8]) -> Result<(), String> {
    let path = dir()?.join(name);
    let encrypted = crypt(bytes, true)?;
    // 在同一目录中替换文件；加密失败时原文件仍保持不变。
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, encrypted).map_err(|e| e.to_string())?;
    fs::rename(tmp, path).map_err(|e| e.to_string())
}
pub fn read(name: &str) -> Result<Option<Vec<u8>>, String> {
    let p = dir()?.join(name);
    if !p.exists() {
        return Ok(None);
    }
    crypt(&fs::read(p).map_err(|e| e.to_string())?, false).map(Some)
}
pub fn remove(name: &str) -> Result<(), String> {
    let p = dir()?.join(name);
    if p.exists() {
        fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

//! Windows CurrentUser DPAPI. Never use machine scope or plaintext fallback.
use std::{fs, path::PathBuf};

pub fn dir() -> Result<PathBuf, String> {
    let p = dirs::data_local_dir()
        .ok_or("找不到用户数据目录")?
        .join("CodeSeam");
    fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(p)
}

#[cfg(windows)]
fn crypt(bytes: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    #[repr(C)]
    struct Blob {
        len: u32,
        data: *mut u8,
    }
    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(
            input: *const Blob,
            description: *const u16,
            entropy: *const Blob,
            reserved: *mut std::ffi::c_void,
            prompt: *mut std::ffi::c_void,
            flags: u32,
            output: *mut Blob,
        ) -> i32;
        fn CryptUnprotectData(
            input: *const Blob,
            description: *mut *mut u16,
            entropy: *const Blob,
            reserved: *mut std::ffi::c_void,
            prompt: *mut std::ffi::c_void,
            flags: u32,
            output: *mut Blob,
        ) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(ptr: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
    }
    let input = Blob {
        len: bytes.len().try_into().map_err(|_| "凭据过大")?,
        data: bytes.as_ptr() as *mut u8,
    };
    let mut output = Blob {
        len: 0,
        data: std::ptr::null_mut(),
    };
    unsafe {
        let ok = if protect {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                1,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                1,
                &mut output,
            )
        };
        if ok == 0 {
            return Err("Windows 用户凭据保护失败，请重新登录".into());
        }
        let result = std::slice::from_raw_parts(output.data, output.len as usize).to_vec();
        std::ptr::write_bytes(output.data, 0, output.len as usize);
        LocalFree(output.data.cast());
        Ok(result)
    }
}
#[cfg(not(windows))]
fn crypt(_: &[u8], _: bool) -> Result<Vec<u8>, String> {
    Err("P1 受管凭据仅支持 Windows".into())
}

pub fn save(name: &str, bytes: &[u8]) -> Result<(), String> {
    let path = dir()?.join(name);
    let encrypted = crypt(bytes, true)?;
    // Same-directory replacement; original remains intact if encryption fails.
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

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn current_user_dpapi_roundtrip_and_tamper_rejection() {
        let secret = b"private-service-key-not-plaintext";
        let mut data = crypt(secret, true).unwrap();
        assert!(!data.windows(secret.len()).any(|w| w == secret));
        assert_eq!(crypt(&data, false).unwrap(), secret);
        let n = data.len();
        data[n - 1] ^= 0xff;
        assert!(crypt(&data, false).is_err());
    }
}

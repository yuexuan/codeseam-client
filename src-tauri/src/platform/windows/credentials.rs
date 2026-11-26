//! 使用 Windows 当前用户范围的 DPAPI。
#[cfg(windows)]
pub(crate) fn crypt(bytes: &[u8], protect: bool) -> Result<Vec<u8>, String> {
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
            return Err("Windows 当前用户数据解密或加密失败".into());
        }
        let result = std::slice::from_raw_parts(output.data, output.len as usize).to_vec();
        std::ptr::write_bytes(output.data, 0, output.len as usize);
        LocalFree(output.data.cast());
        Ok(result)
    }
}
#[cfg(not(windows))]
pub(crate) fn crypt(_: &[u8], _: bool) -> Result<Vec<u8>, String> {
    Err("受管备份仅支持 Windows".into())
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

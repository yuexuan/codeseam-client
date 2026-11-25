use crate::domain::Check;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    io::{Read, Write},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
pub fn hidden(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}
pub fn scan() -> Result<Vec<Check>, String> {
    run_script(include_bytes!("preflight.ps1"))
}
pub fn run_script<T: serde::de::DeserializeOwned>(script: &[u8]) -> Result<T, String> {
    run_script_with_timeout(script, Duration::from_secs(45))
}
pub fn run_script_with_timeout<T: serde::de::DeserializeOwned>(
    script: &[u8],
    timeout: Duration,
) -> Result<T, String> {
    if !cfg!(windows) {
        return Err("环境预检当前仅支持 Windows".into());
    }
    let mut child = hidden("powershell.exe").args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $s=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd())); try { & ([ScriptBlock]::Create($s)) } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }"])
 .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("无法启动 Windows 操作：{e}"))?;
    #[cfg(windows)]
    let _job = match super::managed_process::Job::new(&child) {
        Ok(job) => job,
        Err(error) => {
            child.kill().map_err(|e| e.to_string())?;
            child.wait().map_err(|e| e.to_string())?;
            return Err(error);
        }
    };
    child
        .stdin
        .take()
        .ok_or("检测进程输入不可用")?
        .write_all(STANDARD.encode(script).as_bytes())
        .map_err(|e| e.to_string())?;
    let mut stdout = child.stdout.take().ok_or("检测输出不可用")?;
    let mut stderr = child.stderr.take().ok_or("检测错误输出不可用")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).map(|_| bytes)
    });
    let error_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).map(|_| bytes)
    });
    let started = Instant::now();
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            break;
        }
        if started.elapsed() > timeout {
            child.kill().map_err(|e| e.to_string())?;
            child.wait().map_err(|e| e.to_string())?;
            return Err(format!(
                "Windows 操作超过 {} 秒，进程已停止；请复核实际状态后重试",
                timeout.as_secs()
            ));
        }
        std::thread::sleep(Duration::from_millis(80));
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let bytes = reader
        .join()
        .map_err(|_| "检测输出读取中断")?
        .map_err(|e| e.to_string())?;
    let errors = error_reader
        .join()
        .map_err(|_| "检测错误读取中断")?
        .map_err(|e| e.to_string())?;
    if !status.success() {
        let stderr = String::from_utf8_lossy(&errors);
        let message = stderr.lines().map(str::trim).find(|line| !line.is_empty())
            .filter(|line| line.chars().count() <= 500 && !line.contains("FromBase64String(")
                && !line.starts_with('$') && !line.starts_with("& {"))
            .unwrap_or("Windows 未返回简短的错误说明，请查看本机事件日志");
        return Err(format!("Windows 操作失败：{message}"));
    }
    serde_json::from_slice(&bytes).map_err(|e| format!("Windows 检查返回合同错误：{e}"))
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn script_transport_preserves_unicode_and_parser_errors() {
        let result: serde_json::Value = super::run_script("@{text='中文与引号：用户桌面'} | ConvertTo-Json -Compress".as_bytes()).unwrap();
        assert_eq!(result["text"], "中文与引号：用户桌面");
        let error = super::run_script::<serde_json::Value>("$ErrorActionPreference='Stop'; throw '中文失败'".as_bytes()).unwrap_err();
        assert!(error.contains("中文失败"), "{error}");
        assert!(!error.contains('�'), "{error}");
        assert!(super::run_script::<serde_json::Value>(b"'unterminated").is_err());
    }
}

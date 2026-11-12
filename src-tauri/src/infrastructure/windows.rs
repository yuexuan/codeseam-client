use crate::domain::Check;
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
    if !cfg!(windows) {
        return Err("环境预检当前仅支持 Windows".into());
    }
    let mut child = hidden("powershell.exe").args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "[Console]::InputEncoding=[Text.UTF8Encoding]::new($false); $s=[Console]::In.ReadToEnd(); & ([ScriptBlock]::Create($s))"])
 .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("无法启动 Windows 只读检查：{e}"))?;
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
        .write_all(include_bytes!("preflight.ps1"))
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
        if started.elapsed() > Duration::from_secs(45) {
            child.kill().map_err(|e| e.to_string())?;
            child.wait().map_err(|e| e.to_string())?;
            return Err("Windows 检查超过 45 秒，检测进程已停止；可重新检测".into());
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
        return Err(format!(
            "Windows 只读检查失败：{}",
            String::from_utf8_lossy(&errors)
        ));
    }
    serde_json::from_slice(&bytes).map_err(|e| format!("Windows 检查返回合同错误：{e}"))
}

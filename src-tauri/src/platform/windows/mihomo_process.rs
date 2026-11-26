use super::managed_process;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Child, Stdio},
};

pub(crate) const VERSION: &str = "v1.19.34";

pub(crate) fn binary_path(root: &Path) -> PathBuf {
    root.join(format!("mihomo-{VERSION}.exe"))
}

pub(crate) fn prepare(root: &Path) -> Result<PathBuf, String> {
    let binary = binary_path(root);
    if !binary.exists() {
        fs::write(&binary, include_bytes!("../../../resources/mihomo.exe"))
            .map_err(|_| "无法释放 Mihomo 内核")?;
    }
    Ok(binary)
}

pub(crate) struct Process {
    pub child: Child,
    #[cfg(windows)]
    _job: managed_process::Job,
}

pub(crate) fn launch(binary: &Path, dir: &Path) -> Result<Process, String> {
    let mut command = managed_process::hidden(binary);
    command
        .arg("-d")
        .arg(dir)
        .arg("-f")
        .arg(dir.join("config.json"))
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = command.spawn().map_err(|_| "Mihomo 启动失败")?;
    #[cfg(windows)]
    let job = match managed_process::Job::new(&child) {
        Ok(job) => job,
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(e);
        }
    };
    Ok(Process {
        child,
        #[cfg(windows)]
        _job: job,
    })
}

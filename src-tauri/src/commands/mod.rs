mod claude;
use crate::{
    application,
    domain::{AppError, RecoveryAction, Report, Startup},
    infrastructure::operation_log,
};
pub use claude::*;
use std::time::Instant;
mod nodes;
mod runtime;
pub use nodes::*;
pub use runtime::*;
#[derive(Default)]
pub struct Operations(
    pub tokio::sync::Mutex<()>,
    pub(crate) tokio::sync::Mutex<()>,
);
impl Operations {
    async fn wait(&self, operation: &str) -> Result<tokio::sync::MutexGuard<'_, ()>, AppError> {
        tokio::time::timeout(std::time::Duration::from_secs(660), self.0.lock())
            .await
            .map_err(|_| AppError::new(operation, "等待前一个操作完成超时，请检查运行环境后重试".into()))
    }
}

#[cfg(test)]
mod operation_tests {
    use super::Operations;

    #[test]
    fn browser_waits_for_guest_scan_to_release_lock() {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
            .block_on(async {
                let operations = std::sync::Arc::new(Operations::default());
                let scan = operations.0.lock().await;
                let queued = operations.clone();
                let browser = tokio::spawn(async move {
                    let _guard = queued.wait("prepare_browser").await.unwrap();
                });
                tokio::task::yield_now().await;
                assert!(!browser.is_finished());
                drop(scan);
                browser.await.unwrap();
                assert!(operations.0.try_lock().is_ok());
            });
    }
}
fn finish<T>(operation: &str, started: Instant, result: Result<T, String>) -> Result<T, AppError> {
    let logged = operation_log::record(operation, started.elapsed(), result.is_ok());
    match (result, logged) {
        (Ok(value), Ok(_)) => Ok(value),
        (Err(error), Ok(id)) => Err(AppError::new(operation, format!("{error} [记录 {id}]"))),
        (Ok(_), Err(error)) => Err(AppError::new(
            operation,
            format!("操作已执行，但本地诊断记录保存失败：{error}；请复验当前状态"),
        )),
        (Err(error), Err(log_error)) => Err(AppError::new(
            operation,
            format!("{error}；本地诊断记录也未能保存：{log_error}"),
        )),
    }
}
#[tauri::command]
#[specta::specta]
pub fn read_startup() -> Result<Startup, AppError> {
    let started = Instant::now();
    finish("read_startup", started, application::state::load())
}
#[tauri::command]
#[specta::specta]
pub async fn scan_environment(state: tauri::State<'_, Operations>) -> Result<Report, AppError> {
    let started = Instant::now();
    let _guard = match state.0.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            return finish(
                "scan_environment",
                started,
                Err("已有检测或恢复正在执行".into()),
            )
        }
    };
    let result = tokio::task::spawn_blocking(application::scan)
        .await
        .map_err(|e| e.to_string())
        .and_then(|result| result);
    finish("scan_environment", started, result)
}
#[tauri::command]
#[specta::specta]
pub async fn restore_legacy(
    state: tauri::State<'_, Operations>,
    action: RecoveryAction,
) -> Result<(), AppError> {
    let started = Instant::now();
    let _guard = match state.0.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            return finish(
                "restore_legacy",
                started,
                Err("已有检测或恢复正在执行".into()),
            )
        }
    };
    let result = tokio::task::spawn_blocking(move || match action {
        RecoveryAction::Cli => application::recovery::restore_cli(),
        RecoveryAction::Ipv6 => crate::infrastructure::network_recovery::restore("disable_ipv6"),
        RecoveryAction::TimeSync => {
            crate::infrastructure::network_recovery::restore("enable_time_sync")
        }
        RecoveryAction::Timezone => {
            crate::infrastructure::network_recovery::restore("set_timezone")
        }
        RecoveryAction::Dns => crate::infrastructure::network_recovery::restore("set_dns"),
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|result| result);
    finish("restore_legacy", started, result)
}

mod browser;
pub use browser::*;
mod workbench;
pub use workbench::*;

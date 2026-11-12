use crate::{
    application,
    domain::{AppError, RecoveryAction, Report, Startup},
    infrastructure::operation_log,
};
use std::time::Instant;
mod nodes;
pub use nodes::*;
#[derive(Default)]
pub struct Operations(pub tokio::sync::Mutex<()>);
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
        RecoveryAction::Dns => crate::infrastructure::network_recovery::restore("set_dns"),
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|result| result);
    finish("restore_legacy", started, result)
}

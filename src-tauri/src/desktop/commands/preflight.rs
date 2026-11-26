use super::*;
use crate::domain::{RecoveryAction, Report, Startup};

#[tauri::command]
#[specta::specta]
pub fn read_startup() -> Result<Startup, AppError> {
    let started = Instant::now();
    finish(
        "read_startup",
        started,
        application::preflight::checkpoint::load(),
    )
}
#[tauri::command]
#[specta::specta]
pub async fn scan_environment(state: tauri::State<'_, Operations>) -> Result<Report, AppError> {
    let started = Instant::now();
    let _guard = match state.environment.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            return finish(
                "scan_environment",
                started,
                Err("已有检测或恢复正在执行".into()),
            )
        }
    };
    let result = tokio::task::spawn_blocking(application::preflight::scan)
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
    let _guard = match state.environment.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            return finish(
                "restore_legacy",
                started,
                Err("已有检测或恢复正在执行".into()),
            )
        }
    };
    let result = tokio::task::spawn_blocking(move || application::recovery::restore(action))
        .await
        .map_err(|e| e.to_string())
        .and_then(|result| result);
    finish("restore_legacy", started, result)
}

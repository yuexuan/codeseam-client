use super::*;
use crate::application::claude::CleanupReport;
#[tauri::command]
#[specta::specta]
pub async fn claude_cleanup(
    state: tauri::State<'_, Operations>,
    action: String,
    ids: Vec<String>,
) -> Result<CleanupReport, AppError> {
    let _guard = state
        .0
        .try_lock()
        .map_err(|_| AppError::new("claude_cleanup", "已有操作正在执行".into()))?;
    let started = Instant::now();
    let result = tokio::task::spawn_blocking(move || match action.as_str() {
        "scan" => application::claude::read(),
        "clean" => application::claude::clean(ids),
        "restore" => application::claude::restore(),
        _ => Err("未知操作".into()),
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r);
    finish("claude_cleanup", started, result)
}

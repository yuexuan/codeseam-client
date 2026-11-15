use super::*;
#[tauri::command]
#[specta::specta]
pub async fn prepare_browser(
    state: tauri::State<'_, Operations>,
    virtual_runtime: bool,
    browser: String,
) -> Result<String, AppError> {
    let started = Instant::now();
    let _guard = state.wait("prepare_browser").await?;
    let result = tokio::task::spawn_blocking(move || {
        application::browser::prepare(virtual_runtime, browser)
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r);
    finish("prepare_browser", started, result)
}

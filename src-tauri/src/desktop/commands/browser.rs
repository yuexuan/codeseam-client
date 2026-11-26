use super::*;
#[tauri::command]
#[specta::specta]
pub async fn browser_action(
    state: tauri::State<'_, Operations>,
    virtual_runtime: bool,
    browser: String,
    action: String,
) -> Result<String, AppError> {
    let started = Instant::now();
    let _guard = state.wait("browser_action").await?;
    let result = tokio::task::spawn_blocking(move || {
        application::browser::execute(virtual_runtime, browser, action)
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r);
    finish("browser_action", started, result)
}

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

use super::*;
#[tauri::command]
#[specta::specta]
pub async fn workbench_operation(
    state: tauri::State<'_, Operations>,
    action: String,
    payload: String,
) -> Result<String, AppError> {
    let started = Instant::now();
    let _guard = state.wait("workbench_operation").await?;
    let result =
        tokio::task::spawn_blocking(move || application::workbench::execute(action, payload))
            .await
            .map_err(|e| e.to_string())
            .and_then(|r| r);
    finish("workbench_operation", started, result)
}

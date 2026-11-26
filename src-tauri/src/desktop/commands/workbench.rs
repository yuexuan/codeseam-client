use super::*;
#[tauri::command]
#[specta::specta]
pub async fn workbench_operation(
    app: tauri::AppHandle,
    state: tauri::State<'_, Operations>,
    action: String,
    payload: String,
) -> Result<String, AppError> {
    let started = Instant::now();
    let operation = format!("workbench_{}", action);
    let _guard = state.wait(&operation).await?;
    let exit = action == "exit_prepare";
    let result =
        tokio::task::spawn_blocking(move || application::workbench::execute(action, payload))
            .await
            .map_err(|e| e.to_string())
            .and_then(|r| r);
    let result = finish(&operation, started, result)?;
    if exit
        && serde_json::from_str::<serde_json::Value>(&result).is_ok_and(|v| v["stopped"] == true)
    {
        app.exit(0);
    }
    Ok(result)
}

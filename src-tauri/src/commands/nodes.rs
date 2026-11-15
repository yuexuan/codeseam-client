use super::{finish, Operations};
use crate::{
    application::nodes,
    domain::{
        nodes::{GeneralProxy, ImportResult, NodeSnapshot},
        AppError,
    },
};
use std::time::Instant;
use tauri::Emitter;

async fn run<T: Send + 'static>(
    _state: tauri::State<'_, Operations>,
    operation: &'static str,
    action: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, AppError> {
    let started = Instant::now();
    let result = tokio::task::spawn_blocking(action)
        .await
        .map_err(|_| "节点操作未完成".to_string())
        .and_then(|result| result);
    finish(operation, started, result)
}
#[tauri::command]
#[specta::specta]
pub async fn read_nodes(state: tauri::State<'_, Operations>) -> Result<NodeSnapshot, AppError> {
    run(state, "read_nodes", nodes::read).await
}
#[tauri::command]
#[specta::specta]
pub async fn import_nodes(
    state: tauri::State<'_, Operations>,
    links: String,
) -> Result<ImportResult, AppError> {
    run(state, "import_nodes", move || nodes::import_links(links)).await
}
#[tauri::command]
#[specta::specta]
pub async fn import_proxy(
    state: tauri::State<'_, Operations>,
    proxy: GeneralProxy,
) -> Result<ImportResult, AppError> {
    run(state, "import_proxy", move || nodes::import_proxy(proxy)).await
}
#[tauri::command]
#[specta::specta]
pub async fn select_node(state: tauri::State<'_, Operations>, id: String) -> Result<(), AppError> {
    run(state, "select_node", move || nodes::select(id)).await
}
#[tauri::command]
#[specta::specta]
pub async fn remove_node(state: tauri::State<'_, Operations>, id: String) -> Result<(), AppError> {
    run(state, "remove_node", move || nodes::remove(id)).await
}
#[tauri::command]
#[specta::specta]
pub async fn test_nodes(
    state: tauri::State<'_, Operations>,
    app: tauri::AppHandle,
    ids: Vec<String>,
) -> Result<(), AppError> {
    let _guard = state
        .1
        .try_lock()
        .map_err(|_| AppError::new("test_nodes", "节点测速正在执行".into()))?;
    run(state.clone(), "test_nodes", move || {
        nodes::test_ordered_with_progress(ids, |snapshot| {
            let _ = app.emit("nodes-progress", snapshot);
        })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn clear_nodes(state: tauri::State<'_, Operations>) -> Result<(), AppError> {
    let _guard = state
        .1
        .try_lock()
        .map_err(|_| AppError::new("clear_nodes", "请等待测速完成后清空".into()))?;
    run(state.clone(), "clear_nodes", nodes::clear).await
}

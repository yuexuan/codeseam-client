use super::*;
use crate::domain::runtime::*;

#[tauri::command]
#[specta::specta]
pub async fn virtual_operation(
    state: tauri::State<'_, Operations>,
    action: String,
    payload: String,
) -> Result<String, AppError> {
    if action == "image_status" || action == "status" {
        return application::runtime::virtual_runtime::execute(action, payload)
            .map_err(|e| AppError::new("virtual_operation", e));
    }
    let started = Instant::now();
    let _guard = if action == "initialize" || action == "ensure_ready" {
        state.wait("virtual_operation").await?
    } else {
        state
            .environment
            .try_lock()
            .map_err(|_| AppError::new("virtual_operation", "已有操作正在执行".into()))?
    };
    let result = tokio::task::spawn_blocking(move || {
        application::runtime::virtual_runtime::execute(action, payload)
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r);
    finish("virtual_operation", started, result)
}

#[tauri::command]
#[specta::specta]
pub async fn read_hyperv_compatibility(
    state: tauri::State<'_, Operations>,
) -> Result<Vec<crate::domain::Check>, AppError> {
    let started = Instant::now();
    let _guard = state
        .environment
        .try_lock()
        .map_err(|_| AppError::new("read_hyperv_compatibility", "已有检测或恢复正在执行".into()))?;
    let result = tokio::task::spawn_blocking(application::runtime::read_compatibility)
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    finish("read_hyperv_compatibility", started, result)
}

#[tauri::command]
#[specta::specta]
pub async fn read_runtime(state: tauri::State<'_, Operations>) -> Result<RuntimeReport, AppError> {
    let started = Instant::now();
    let _guard = state
        .environment
        .try_lock()
        .map_err(|_| AppError::new("read_runtime", "已有检测或恢复正在执行".into()))?;
    let result = tokio::task::spawn_blocking(application::runtime::read)
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    finish("read_runtime", started, result)
}
#[tauri::command]
#[specta::specta]
pub async fn confirm_native_runtime(
    state: tauri::State<'_, Operations>,
    revision: String,
) -> Result<RuntimeReport, AppError> {
    let started = Instant::now();
    let _guard = state
        .environment
        .try_lock()
        .map_err(|_| AppError::new("confirm_native_runtime", "已有检测或恢复正在执行".into()))?;
    let result = tokio::task::spawn_blocking(move || application::runtime::confirm(revision))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    finish("confirm_native_runtime", started, result)
}
#[tauri::command]
#[specta::specta]
pub fn open_runtime_setting(setting: RuntimeSetting) -> Result<(), AppError> {
    finish(
        "open_runtime_setting",
        Instant::now(),
        application::runtime::open_setting(setting),
    )
}

#[tauri::command]
#[specta::specta]
pub async fn apply_runtime_setting(
    state: tauri::State<'_, Operations>,
    setting: RuntimeSetting,
    revision: String,
    target: Option<String>,
) -> Result<RuntimeReport, AppError> {
    let started = Instant::now();
    let _guard = state
        .environment
        .try_lock()
        .map_err(|_| AppError::new("apply_runtime_setting", "已有检测或设置正在执行".into()))?;
    let result = tokio::task::spawn_blocking(move || {
        application::runtime::apply_setting(setting, revision, target)
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r);
    finish("apply_runtime_setting", started, result)
}

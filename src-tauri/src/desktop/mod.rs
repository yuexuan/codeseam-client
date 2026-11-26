mod commands;
mod operations;
mod scheduler;
mod tray;

use crate::application;
use tauri::Manager;
fn bindings() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::new().commands(tauri_specta::collect_commands![
        commands::claude_cleanup,
        commands::prepare_browser,
        commands::browser_action,
        commands::workbench_operation,
        commands::read_startup,
        commands::scan_environment,
        commands::restore_legacy,
        commands::read_nodes,
        commands::import_nodes,
        commands::import_proxy,
        commands::select_node,
        commands::remove_node,
        commands::test_nodes,
        commands::clear_nodes,
        commands::read_runtime,
        commands::virtual_operation,
        commands::read_hyperv_compatibility,
        commands::confirm_native_runtime,
        commands::apply_runtime_setting,
        commands::open_runtime_setting
    ])
}
pub fn run() {
    let builder = bindings();
    tauri::Builder::default()
        .manage(operations::Operations::default())
        .setup(|app| {
            tray::install(app)?;
            if std::env::args().any(|arg| arg == "--background") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            scheduler::start_daily_checks(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if application::workbench::load().ok().flatten().is_some() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("CodeSeam 启动失败");
}
pub fn export_bindings() {
    let target = std::env::var("CODESEAM_BINDINGS_PATH")
        .unwrap_or_else(|_| "../src/bindings/commands.ts".into());
    bindings()
        .export(specta_typescript::Typescript::default(), target)
        .expect("生成绑定失败");
}

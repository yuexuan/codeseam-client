mod application;
mod commands;
mod domain;
mod infrastructure;
use tauri::{Emitter, Manager};
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
pub fn network_helper(token: &str) -> i32 {
    infrastructure::network_recovery::helper(token)
}
pub fn uninstall() -> Result<(), String> {
    application::recovery::restore_cli()?;
    application::recovery::finish_legacy_session()
}
pub fn run() {
    let builder = bindings();
    tauri::Builder::default()
        .manage(commands::Operations::default())
        .setup(|app| {
            use tauri::menu::{Menu,MenuItem};
            use tauri::tray::{TrayIconBuilder,TrayIconEvent,MouseButton,MouseButtonState};
            let open=MenuItem::with_id(app,"open","打开工作台",true,None::<&str>)?;
            let quit=MenuItem::with_id(app,"quit","退出 CodeSeam",true,None::<&str>)?;
            let menu=Menu::with_items(app,&[&open,&quit])?;
            let mut tray=TrayIconBuilder::new().menu(&menu).tooltip("CodeSeam · Guardian").show_menu_on_left_click(false)
                .on_menu_event(|app,event| {
                    if event.id.as_ref()=="quit" && application::workbench::load().ok().flatten().is_none() { app.exit(0); return }
                    if let Some(window)=app.get_webview_window("main") { let _=window.show(); let _=window.unminimize(); let _=window.set_focus(); if event.id.as_ref()=="quit" { let _=app.emit("exit-requested",()); } }
                })
                .on_tray_icon_event(|tray,event| { if matches!(event,TrayIconEvent::Click {button:MouseButton::Left,button_state:MouseButtonState::Up,..}) { if let Some(window)=tray.app_handle().get_webview_window("main") { let _=window.show();let _=window.unminimize();let _=window.set_focus(); } } });
            if let Some(icon)=app.default_window_icon() { tray=tray.icon(icon.clone()); }
            tray.build(app)?;
            if std::env::args().any(|arg|arg=="--background") { if let Some(window)=app.get_webview_window("main") { let _=window.hide(); } }
            commands::start_daily_checks(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window,event| {
            if let tauri::WindowEvent::CloseRequested {api,..}=event {
                if application::workbench::load().ok().flatten().is_some() { api.prevent_close(); let _=window.hide(); }
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

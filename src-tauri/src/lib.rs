mod application;
mod commands;
mod domain;
mod infrastructure;
fn bindings() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::new().commands(tauri_specta::collect_commands![
        commands::read_startup,
        commands::scan_environment,
        commands::restore_legacy,
        commands::read_nodes,
        commands::import_nodes,
        commands::import_proxy,
        commands::select_node,
        commands::remove_node,
        commands::test_nodes
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

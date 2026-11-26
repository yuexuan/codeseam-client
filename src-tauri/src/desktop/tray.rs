use crate::application::workbench;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

fn show_main(app: &tauri::AppHandle) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    true
}

pub(super) fn install(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "打开工作台", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 CodeSeam", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("CodeSeam · Guardian")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let quit_requested = event.id.as_ref() == "quit";
            if quit_requested && workbench::load().ok().flatten().is_none() {
                app.exit(0);
                return;
            }
            if show_main(app) && quit_requested {
                let _ = app.emit("exit-requested", ());
            }
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

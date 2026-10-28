//! 设置页背后的桌面外壳行为：持久化偏好设置、托盘图标和资源管理器快捷入口。
//! 此处不存放敏感信息；该文件与 DPAPI 凭据文件位于同一目录，但只保存用户可编辑的选项。
use super::vault;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

const FILE: &str = "prefs.json";
/// 仅当托盘图标确实创建成功时才为 true；否则关闭到托盘会隐藏窗口且无法重新打开。
static TRAY: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Prefs {
    /// 客户端启动时重新启用上次使用的服务（启动本地代理）。
    pub auto_connect: bool,
    pub start_minimized: bool,
    pub close_to_tray: bool,
    /// 受管 Claude 终端的工作目录；为空时沿用默认目录。
    pub work_dir: String,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            auto_connect: true,
            start_minimized: false,
            close_to_tray: true,
            work_dir: String::new(),
        }
    }
}

pub fn load() -> Prefs {
    vault::dir()
        .ok()
        .and_then(|d| fs::read(d.join(FILE)).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

/// 保存前规范化并校验用户输入。
pub fn checked(mut p: Prefs) -> Result<Prefs, String> {
    p.work_dir = p.work_dir.trim().trim_matches('"').to_owned();
    if !p.work_dir.is_empty() && !Path::new(&p.work_dir).is_dir() {
        return Err("工作目录不存在或不是文件夹".into());
    }
    Ok(p)
}

pub fn save(p: &Prefs) -> Result<(), String> {
    let path = vault::dir()?.join(FILE);
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(p).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    fs::rename(tmp, path).map_err(|e| e.to_string())
}

pub fn tray_ready() -> bool {
    TRAY.load(Ordering::Relaxed)
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let Some(icon) = app.default_window_icon().cloned() else {
        return Ok(());
    };
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "show", "打开 CodeSeam", true, None::<&str>)?,
            &MenuItem::with_id(app, "quit", "退出（停止代理与受管终端）", true, None::<&str>)?,
        ],
    )?;
    TrayIconBuilder::with_id("codeseam")
        .icon(icon)
        .tooltip("CodeSeam")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    TRAY.store(true, Ordering::Relaxed);
    Ok(())
}

/// 打开用户可能需要查看的目录。仅接受固定目录类型，WebView 不会提供路径。
pub fn folder<R: Runtime>(app: &AppHandle<R>, kind: &str, prefs: &Prefs) -> Result<PathBuf, String> {
    let dir = match kind {
        "claude" => super::cli::config_dir()?,
        "data" => vault::dir()?,
        "work" => {
            if prefs.work_dir.is_empty() {
                return Err("尚未设置工作目录".into());
            }
            PathBuf::from(&prefs.work_dir)
        }
        "license" => app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("LICENSE")
            .parent()
            .map(Path::to_path_buf)
            .ok_or("找不到许可文件目录")?,
        _ => return Err("未知目录".into()),
    };
    if !dir.is_dir() {
        return Err(format!("目录不存在：{}", dir.display()));
    }
    Ok(dir)
}

pub fn reveal(dir: &Path) -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("无法打开 {}：{e}", dir.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let p: Prefs = serde_json::from_str(r#"{"start_minimized":true}"#).unwrap();
        assert!(p.start_minimized && p.auto_connect && p.close_to_tray);
        assert!(p.work_dir.is_empty());
    }

    #[test]
    fn work_dir_must_be_an_existing_folder() {
        let ok = Prefs {
            work_dir: format!("  \"{}\"  ", std::env::temp_dir().display()),
            ..Prefs::default()
        };
        assert_eq!(
            checked(ok).unwrap().work_dir,
            std::env::temp_dir().display().to_string()
        );
        let bad = Prefs {
            work_dir: r"Z:\definitely\not\here".into(),
            ..Prefs::default()
        };
        assert!(checked(bad).is_err());
        assert!(checked(Prefs::default()).is_ok());
    }
}

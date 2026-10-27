// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|a| a == "--codeseam-uninstall") {
        std::process::exit(if z_switch_lib::codeseam_uninstall().is_ok() {
            0
        } else {
            1
        });
    }
    z_switch_lib::run()
}

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<_> = std::env::args().collect();
    if args.get(1).is_some_and(|a| a == "--codeseam-network-helper") {
        std::process::exit(if args.len() == 3 { z_switch_lib::codeseam_network_helper(&args[2]) } else { 1 });
    }
    if std::env::args().any(|a| a == "--codeseam-uninstall") {
        std::process::exit(if z_switch_lib::codeseam_uninstall().is_ok() {
            0
        } else {
            1
        });
    }
    z_switch_lib::run()
}

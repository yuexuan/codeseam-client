#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args
        .get(1)
        .is_some_and(|a| a == "--codeseam-network-helper")
    {
        std::process::exit(if args.len() == 3 {
            codeseam_lib::network_helper(&args[2])
        } else {
            1
        });
    }
    if args.get(1).is_some_and(|a| a == "--codeseam-uninstall") {
        match codeseam_lib::uninstall() {
            Ok(()) => std::process::exit(0),
            Err(e) => {
                eprintln!("{e}");
                std::process::exit(1)
            }
        }
    }
    codeseam_lib::run();
}

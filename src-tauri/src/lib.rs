mod application;
mod desktop;
mod domain;
mod infrastructure;
mod platform;

pub use desktop::{export_bindings, run};

pub fn network_helper(token: &str) -> i32 {
    platform::network::helper(token)
}
pub fn uninstall() -> Result<(), String> {
    application::recovery::restore_cli()?;
    application::recovery::finish_legacy_session()
}

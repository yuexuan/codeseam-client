use crate::infrastructure::vault;
use crate::platform::autostart;
use serde_json::{json, Value};
pub fn read() -> Result<Value, String> {
    let saved = vault::read("preferences-v1.dpapi")?
        .map(|v| serde_json::from_slice::<Value>(&v).map_err(|e| e.to_string()))
        .transpose()?
        .unwrap_or(json!({"startup":true}));
    let current = autostart::registered()?;
    Ok(json!({"startup":saved["startup"],"registered":current["registered"]}))
}
pub fn set_startup(enabled: bool) -> Result<Value, String> {
    autostart::set_registered(enabled)?;
    vault::save(
        "preferences-v1.dpapi",
        &serde_json::to_vec(&json!({"startup":enabled})).map_err(|e| e.to_string())?,
    )?;
    read()
}
#[cfg(not(test))]
pub fn initialize() -> Result<(), String> {
    if vault::read("preferences-v1.dpapi")?.is_none() {
        set_startup(true)?;
    }
    Ok(())
}

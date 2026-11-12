use super::vault;
use std::{
    fs::OpenOptions,
    io::Write,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
pub fn record(operation: &str, elapsed: Duration, succeeded: bool) -> Result<String, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    let id = format!(
        "{}-{}-{}",
        std::process::id(),
        now.as_nanos(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let line=serde_json::json!({"id":id,"operation":operation,"elapsedMs":elapsed.as_millis(),"outcome":if succeeded{"ok"}else{"error"}}).to_string()+"\n";
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(vault::dir()?.join("operations.jsonl"))
        .map_err(|e| e.to_string())?;
    file.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    Ok(id)
}

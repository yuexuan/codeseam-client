use crate::{
    domain::{ScanPhase, Startup},
    infrastructure::vault,
};
use std::fs;
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Checkpoint {
    schema: u32,
    scan_phase: ScanPhase,
    last_observed_at: Option<String>,
}

pub fn load() -> Result<Startup, String> {
    let path = vault::dir()?.join("initialization.json");
    let mut state = match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice::<Checkpoint>(&bytes)
            .map_err(|e| format!("初始化记录损坏：{e}"))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Checkpoint {
            schema: 1,
            scan_phase: ScanPhase::NotStarted,
            last_observed_at: None,
        },
        Err(e) => return Err(e.to_string()),
    };
    if state.schema != 1 {
        return Err(format!(
            "不支持的初始化记录版本 {}；原记录已保留",
            state.schema
        ));
    }
    if matches!(state.scan_phase, ScanPhase::Scanning) {
        state.scan_phase = ScanPhase::Interrupted;
    }
    Ok(Startup {
        schema: state.schema,
        scan_phase: state.scan_phase,
        last_observed_at: state.last_observed_at,
        recovery: super::recovery::inventory()?,
    })
}
pub fn save(state: &Startup) -> Result<(), String> {
    let path = vault::dir()?.join("initialization.json");
    let temp = path.with_extension("tmp");
    fs::write(
        &temp,
        serde_json::to_vec_pretty(&Checkpoint {
            schema: state.schema,
            scan_phase: state.scan_phase.clone(),
            last_observed_at: state.last_observed_at.clone(),
        })
        .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temp, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn interrupted_and_invalid_checkpoints_preserve_evidence() {
        let _lock = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
        let root = std::env::temp_dir().join(format!("codeseam-state-{}", std::process::id()));
        let prior = std::env::var_os("CODESEAM_TEST_DATA_DIR");
        std::env::set_var("CODESEAM_TEST_DATA_DIR", &root);
        let result = std::panic::catch_unwind(|| {
            let mut state = load().unwrap();
            assert!(matches!(state.scan_phase, ScanPhase::NotStarted));
            state.scan_phase = ScanPhase::Scanning;
            save(&state).unwrap();
            assert!(matches!(load().unwrap().scan_phase, ScanPhase::Interrupted));
            let path = vault::dir().unwrap().join("initialization.json");
            std::fs::write(&path,br#"{"schema":1,"scanPhase":"completed","lastObservedAt":"1","recovery":["stale prior draft observation"]}"#).unwrap();
            assert!(matches!(load().unwrap().scan_phase, ScanPhase::Completed));
            state.schema = 9;
            save(&state).unwrap();
            let bytes = std::fs::read(&path).unwrap();
            assert!(load().is_err());
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
            std::fs::write(&path, b"damaged").unwrap();
            assert!(load().is_err());
            assert_eq!(std::fs::read(&path).unwrap(), b"damaged");
        });
        match prior {
            Some(v) => std::env::set_var("CODESEAM_TEST_DATA_DIR", v),
            None => std::env::remove_var("CODESEAM_TEST_DATA_DIR"),
        };
        std::fs::remove_dir_all(root).unwrap();
        if let Err(p) = result {
            std::panic::resume_unwind(p);
        }
    }
}

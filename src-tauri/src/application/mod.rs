pub(crate) mod legacy_cli;
pub(crate) mod nodes;
pub(crate) mod recovery;
pub(crate) mod state;
use crate::{
    domain::{Report, ScanPhase},
    infrastructure::windows,
};
pub fn scan() -> Result<Report, String> {
    let mut checkpoint = state::load()?;
    checkpoint.scan_phase = ScanPhase::Scanning;
    state::save(&checkpoint)?;
    let mut checks = windows::scan()?;
    let node = crate::infrastructure::vault::read("sg-node.dpapi")?;
    let configured = nodes::has_nodes()?
        || match node {
            Some(bytes) => {
                let record: serde_json::Value =
                    serde_json::from_slice(&bytes).map_err(|e| format!("旧节点记录损坏：{e}"))?;
                if !record.is_object() {
                    return Err("旧节点记录结构无效".into());
                }
                true
            }
            None => false,
        };
    checks.push(crate::domain::Check {
        id: "nodes".into(),
        group: crate::domain::Group::Network,
        label: "代理节点".into(),
        value: if configured {
            "发现已有节点"
        } else {
            "未配置"
        }
        .into(),
        status: if configured {
            crate::domain::Status::Unknown
        } else {
            crate::domain::Status::Pending
        },
        detail: "仅清点现有加密记录；未验证节点可用性，第二步选择出口后快测。".into(),
        source: "CodeSeam 当前用户加密存储".into(),
        blocking: false,
    });
    let observed_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs()
        .to_string();
    checkpoint.scan_phase = ScanPhase::Completed;
    checkpoint.last_observed_at = Some(observed_at.clone());
    state::save(&checkpoint)?;
    Ok(Report {
        checks,
        observed_at,
    })
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    #[ignore = "explicit read-only Windows evidence, isolated checkpoint directory"]
    fn live_preflight() {
        let _lock = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
        let root =
            std::env::temp_dir().join(format!("codeseam-native-preflight-{}", std::process::id()));
        let prior = std::env::var_os("CODESEAM_TEST_DATA_DIR");
        std::env::set_var("CODESEAM_TEST_DATA_DIR", &root);
        let result = super::scan();
        match prior {
            Some(v) => std::env::set_var("CODESEAM_TEST_DATA_DIR", v),
            None => std::env::remove_var("CODESEAM_TEST_DATA_DIR"),
        };
        let report = result.unwrap();
        assert!(report.checks.iter().any(|c| c.id == "windows"));
        assert!(report.checks.iter().any(|c| c.id == "nodes"));
        std::fs::write(
            "../docs/tasks/evidence/2026-11-11-local-migration/native-live.json",
            serde_json::to_vec_pretty(&report).unwrap(),
        )
        .unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}

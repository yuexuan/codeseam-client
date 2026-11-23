use crate::{
    domain::{nodes::NodeSummary, runtime::*, Check},
    infrastructure::{vault, windows},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::hash::{Hash, Hasher};
use std::{io::Read, time::Duration};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Confirmation {
    schema: u32,
    runtime_id: String,
    node_id: String,
    revision: String,
    confirmed_at: String,
}
fn selected() -> Result<NodeSummary, String> {
    let snapshot = super::nodes::read()?;
    let node = snapshot
        .nodes
        .into_iter()
        .find(|n| Some(&n.id) == snapshot.selected_id.as_ref())
        .ok_or("请先在第二步选择节点")?;
    if node.status != "connected" || node.exit_ip.is_none() {
        return Err("请先完成所选节点的出口测试".into());
    }
    Ok(node)
}
const REQUIRED: &[&str] = &["exit", "timezone", "language", "time_sync", "dns", "ipv6"];
pub fn read_compatibility() -> Result<Vec<Check>, String> {
    windows::run_script(include_bytes!("../infrastructure/hyperv_compatibility.ps1"))
}
fn ready(checks: &[Check]) -> bool {
    REQUIRED.iter().all(|id| {
        checks.iter().filter(|c| c.id == *id).count() == 1
            && checks
                .iter()
                .any(|c| c.id == *id && c.status == crate::domain::Status::Satisfied)
    }) && !checks.iter().any(|c| c.blocking)
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(super) struct TimezoneTarget {
    pub windows_id: String,
    pub iana_id: String,
}
fn timezone_from_iana(iana: &str) -> Option<TimezoneTarget> {
    let windows = match iana {
        "America/Los_Angeles" | "America/Vancouver" => "Pacific Standard Time",
        "America/Denver" | "America/Edmonton" => "Mountain Standard Time",
        "America/Chicago" | "America/Winnipeg" => "Central Standard Time",
        "America/New_York" | "America/Toronto" | "America/Detroit" => "Eastern Standard Time",
        "Asia/Singapore" => "Singapore Standard Time",
        "Asia/Shanghai" | "Asia/Hong_Kong" => "China Standard Time",
        "Asia/Taipei" => "Taipei Standard Time",
        "Asia/Tokyo" => "Tokyo Standard Time",
        "Europe/London" => "GMT Standard Time",
        "Europe/Berlin" | "Europe/Amsterdam" => "W. Europe Standard Time",
        _ => return None,
    };
    // 浏览器提供 Windows 系统时区对应的标准 IANA 时区名称。
    let canonical = match windows {
        "Pacific Standard Time" => "America/Los_Angeles",
        "Mountain Standard Time" => "America/Denver",
        "Central Standard Time" => "America/Chicago",
        "Eastern Standard Time" => "America/New_York",
        "China Standard Time" => "Asia/Shanghai",
        "W. Europe Standard Time" => "Europe/Berlin",
        _ => iana,
    };
    Some(TimezoneTarget { windows_id: windows.into(), iana_id: canonical.into() })
}
pub(super) fn timezone_target(node: &NodeSummary) -> Option<TimezoneTarget> {
    node.exit_ip.as_ref()?.parse::<std::net::IpAddr>().ok()?;
    let single = match node.country_code.as_deref()? {
        "sg" => Some("Asia/Singapore"),
        "hk" | "cn" => Some("Asia/Shanghai"),
        "tw" => Some("Asia/Taipei"),
        "jp" => Some("Asia/Tokyo"),
        "gb" => Some("Europe/London"),
        "de" => Some("Europe/Berlin"),
        _ => None,
    };
    if let Some(zone) = single {
        return timezone_from_iana(zone);
    }
    // 对于跨多个时区的国家，需要查询实际出口 IP 的地理位置。
    let ip = node.exit_ip.as_ref()?.parse::<std::net::IpAddr>().ok()?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .ok()?;
    let response = client
        .get(format!("https://ipwho.is/{ip}"))
        .send()
        .ok()?
        .error_for_status()
        .ok()?;
    let mut body = String::new();
    response.take(65536).read_to_string(&mut body).ok()?;
    let geo: serde_json::Value = serde_json::from_str(&body).ok()?;
    if geo["success"] != true
        || geo["ip"].as_str()?.parse::<std::net::IpAddr>().ok()? != ip
        || geo["country_code"].as_str()?.to_lowercase() != *node.country_code.as_ref()?
    {
        return None;
    }
    timezone_from_iana(geo["timezone"]["id"].as_str()?)
}
fn target_timezone(node: &NodeSummary) -> Option<String> {
    timezone_target(node).map(|target| target.windows_id)
}
fn revision(node: &NodeSummary, checks: &[Check]) -> Result<String, String> {
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    // 对稳定的结果和数值计算哈希；易变的诊断文本不会导致报告失效。
    serde_json::to_string(&(
        node,
        checks
            .iter()
            .map(|c| (&c.id, &c.value, &c.status, c.blocking))
            .collect::<Vec<_>>(),
    ))
    .map_err(|e| e.to_string())?
    .hash(&mut hash);
    Ok(format!("{:x}", hash.finish()))
}
pub fn read() -> Result<RuntimeReport, String> {
    let node = selected()?;
    let target_timezone = target_timezone(&node);
    let target = STANDARD.encode(serde_json::to_vec(&target_timezone).map_err(|e| e.to_string())?);
    let script = format!("$TargetTimezone = ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{target}')) | ConvertFrom-Json);\n{}", include_str!("../infrastructure/runtime.ps1"));
    let mut checks: Vec<Check> = windows::run_script(script.as_bytes())?;
    let exit_result = super::nodes::verify_runtime_exit(&node);
    checks.insert(
        0,
        Check {
            id: "exit".into(),
            group: crate::domain::Group::Network,
            label: "网络出口".into(),
            value: format!(
                "{} · {}",
                node.exit_ip.as_deref().unwrap_or("未知"),
                node.region.as_deref().unwrap_or("未知地区")
            ),
            status: if exit_result.is_ok() {
                crate::domain::Status::Satisfied
            } else {
                crate::domain::Status::Pending
            },
            detail: exit_result
                .clone()
                .err()
                .unwrap_or_else(|| "通过所选节点重新请求并核对出口 IP 与地区".into()),
            source: "Mihomo / Cloudflare trace".into(),
            blocking: exit_result.is_err(),
        },
    );
    let after = selected()?;
    if serde_json::to_string(&node).map_err(|e| e.to_string())?
        != serde_json::to_string(&after).map_err(|e| e.to_string())?
    {
        return Err("检测期间出口发生变化，请重新检测".into());
    }
    let revision = revision(&node, &checks)?;
    let confirmation = vault::read("runtime-v1.dpapi")?
        .map(|b| {
            serde_json::from_slice::<Confirmation>(&b).map_err(|_| "运行环境记录损坏，原记录已保留")
        })
        .transpose()?;
    if confirmation.as_ref().is_some_and(|c| c.schema != 1) {
        return Err("不支持的运行环境记录版本，原记录已保留".into());
    }
    let ready = ready(&checks);
    let confirmed = ready
        && confirmation.as_ref().is_some_and(|c| {
            c.schema == 1
                && c.runtime_id == "native"
                && c.node_id == node.id
                && c.revision == revision
        });
    let observed_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs()
        .to_string();
    Ok(RuntimeReport {
        checks,
        node,
        observed_at,
        revision,
        confirmed,
        ready,
        target_timezone,
    })
}
pub fn confirm(expected: String) -> Result<RuntimeReport, String> {
    let mut report = read()?;
    if report.revision != expected {
        return Err("系统设置或所选出口已变化，请重新检测后确认".into());
    }
    if !report.ready {
        return Err("运行环境尚未全部匹配，请处理未匹配项后重新检测".into());
    }
    super::nodes::with_selected(&report.node, || {
        vault::save(
            "runtime-v1.dpapi",
            &serde_json::to_vec(&Confirmation {
                schema: 1,
                runtime_id: "native".into(),
                node_id: report.node.id.clone(),
                revision: report.revision.clone(),
                confirmed_at: report.observed_at.clone(),
            })
            .map_err(|e| e.to_string())?,
        )
    })?;
    report.confirmed = true;
    Ok(report)
}
pub fn open_setting(setting: RuntimeSetting) -> Result<(), String> {
    let uri = match setting {
        RuntimeSetting::Language => "ms-settings:regionlanguage",
        _ => return Err("请使用应用内的一键设置".into()),
    };
    let status = windows::hidden("explorer.exe")
        .arg(uri)
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("无法打开 Windows 设置，请从开始菜单打开".into())
    }
}

pub fn apply_setting(
    setting: RuntimeSetting,
    expected: String,
    target: Option<String>,
) -> Result<RuntimeReport, String> {
    let report = read()?;
    if report.revision != expected {
        return Err("系统设置或出口已变化，请重新检测后再应用".into());
    }
    let action = match setting {
        RuntimeSetting::Timezone => {
            if target.as_ref() != report.target_timezone.as_ref() || target.is_none() {
                return Err("目标时区必须与当前节点一致，请重新检测".into());
            }
            "set_timezone"
        }
        RuntimeSetting::TimeSync => "enable_time_sync",
        RuntimeSetting::Dns => "set_dns",
        RuntimeSetting::Ipv6 => "disable_ipv6",
        RuntimeSetting::Language => return Err("系统语言请使用语言设置".into()),
    };
    crate::infrastructure::network_recovery::apply_runtime(action, target)?;
    read()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn timezone_targets_follow_exit_metadata_and_never_default_to_image_zone() {
        let mut node = NodeSummary { id: "fixture".into(), name: "name is not geolocation".into(), protocol: "http".into(), region: None, country_code: Some("sg".into()), latency: None, exit_ip: Some("203.0.113.10".into()), status: "connected".into(), error: None };
        let singapore = timezone_target(&node).unwrap();
        assert_eq!(singapore.windows_id, "Singapore Standard Time");
        assert_eq!(singapore.iana_id, "Asia/Singapore");
        node.country_code = Some("jp".into());
        assert_eq!(timezone_target(&node).unwrap().iana_id, "Asia/Tokyo");
        assert_eq!(timezone_from_iana("America/New_York").unwrap().windows_id, "Eastern Standard Time");
        assert_eq!(timezone_from_iana("America/Los_Angeles").unwrap().windows_id, "Pacific Standard Time");
        assert!(timezone_from_iana("unknown").is_none());
        node.country_code = None;
        assert!(timezone_target(&node).is_none());
        node.country_code = Some("sg".into());
        node.exit_ip = None;
        assert!(timezone_target(&node).is_none());
    }
    #[test]
    #[cfg(windows)]
    #[ignore = "explicit read-only runtime detection using installed real nodes and Windows settings"]
    fn installed_runtime_probe() {
        let _lock = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
        assert!(std::env::var_os("CODESEAM_TEST_DATA_DIR").is_none());
        let report = read().expect("installed runtime detection failed");
        assert_eq!(report.checks.len(), 8);
        for id in REQUIRED {
            assert_eq!(report.checks.iter().filter(|c| c.id == *id).count(), 1);
        }
        assert_eq!(report.ready, ready(&report.checks));
        println!(
            "ready={}, confirmed={}, targetTimezone={:?}",
            report.ready, report.confirmed, report.target_timezone
        );
        for check in report.checks {
            println!(
                "{}: {:?}; blocking={}; {}",
                check.id, check.status, check.blocking, check.value
            );
        }
    }
    #[test]
    #[cfg(windows)]
    #[ignore = "explicit read-only Windows probe with isolated fixture node and encrypted runtime record"]
    fn live_native_confirmation() {
        let _lock = crate::infrastructure::TEST_HOME_LOCK.lock().unwrap();
        let root = std::env::temp_dir().join(format!("codeseam-runtime-{}", std::process::id()));
        let prior = std::env::var_os("CODESEAM_TEST_DATA_DIR");
        std::env::set_var("CODESEAM_TEST_DATA_DIR", &root);
        let result = std::panic::catch_unwind(|| {
            // 这里只使用模拟出口元数据，不会启动代理或修改系统设置。
            let store = serde_json::json!({"selectedId":"fixture","nodes":[{"summary":{"id":"fixture","name":"isolated fixture","protocol":"http","region":null,"countryCode":null,"latency":1,"exitIp":"192.0.2.1","status":"connected","error":null},"config":{}}]});
            vault::save("proxy-nodes-v1.dpapi", &serde_json::to_vec(&store).unwrap()).unwrap();
            let report = read().unwrap();
            assert!(!report.confirmed);
            assert_eq!(report.checks.len(), 8);
            assert!(!report.ready);
            assert!(confirm("outdated".into()).is_err());
            assert!(confirm(report.revision.clone()).is_err());
            assert!(vault::read("runtime-v1.dpapi").unwrap().is_none());
            let mut changed = store.clone();
            changed["nodes"][0]["summary"]["exitIp"] = serde_json::json!("192.0.2.2");
            vault::save(
                "proxy-nodes-v1.dpapi",
                &serde_json::to_vec(&changed).unwrap(),
            )
            .unwrap();
            assert!(!read().unwrap().confirmed);
        });
        match prior {
            Some(v) => std::env::set_var("CODESEAM_TEST_DATA_DIR", v),
            None => std::env::remove_var("CODESEAM_TEST_DATA_DIR"),
        };
        std::fs::remove_dir_all(root).unwrap();
        if let Err(error) = result {
            std::panic::resume_unwind(error);
        }
    }
    #[test]
    fn every_required_check_must_match_and_regressions_block_again() {
        let mut checks: Vec<Check> = REQUIRED
            .iter()
            .map(|id| Check {
                id: (*id).into(),
                group: crate::domain::Group::System,
                label: (*id).into(),
                value: "ok".into(),
                status: crate::domain::Status::Satisfied,
                detail: String::new(),
                source: "fixture".into(),
                blocking: false,
            })
            .collect();
        assert!(ready(&checks));
        for i in 0..checks.len() {
            for status in [
                crate::domain::Status::Pending,
                crate::domain::Status::Unknown,
                crate::domain::Status::Optional,
            ] {
                checks[i].status = status;
                assert!(
                    !ready(&checks),
                    "{} cannot pass without matching",
                    checks[i].id
                );
            }
            checks[i].status = crate::domain::Status::Satisfied;
        }
        let removed = checks.pop().unwrap();
        assert!(!ready(&checks));
        checks.push(removed.clone());
        checks.push(removed);
        assert!(!ready(&checks));
        checks.pop();
        checks[0].blocking = true;
        assert!(!ready(&checks));
    }
    #[test]
    fn revision_changes_with_exit_or_system_settings() {
        let mut node = NodeSummary {
            id: "a".into(),
            name: "node".into(),
            protocol: "ss".into(),
            region: None,
            country_code: None,
            latency: Some(20),
            exit_ip: Some("192.0.2.1".into()),
            status: "connected".into(),
            error: None,
        };
        let first = revision(&node, &[]).unwrap();
        node.exit_ip = Some("192.0.2.2".into());
        assert_ne!(first, revision(&node, &[]).unwrap());
        let check = Check {
            id: "timezone".into(),
            group: crate::domain::Group::System,
            label: "时区".into(),
            value: "UTC+8".into(),
            status: crate::domain::Status::Satisfied,
            detail: String::new(),
            source: String::new(),
            blocking: false,
        };
        assert_ne!(
            revision(&node, &[]).unwrap(),
            revision(&node, &[check]).unwrap()
        );
    }
}

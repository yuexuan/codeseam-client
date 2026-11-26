use super::powershell;
use crate::infrastructure::vault;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    hash::{Hash, Hasher},
    time::Duration,
};
const AGENT: &str = include_str!("guardian_agent.ps1");
const HOST: &str = include_str!("guardian_host.ps1");
pub(crate) fn generation(record: &Value) -> String {
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    record["baseline"]["profile"].to_string().hash(&mut hash);
    record["confirmedAt"].to_string().hash(&mut hash);
    AGENT.hash(&mut hash);
    HOST.hash(&mut hash);
    format!("g1-{:x}", hash.finish())
}
pub(crate) fn control(action: &str, record: &Value, recover: bool) -> Result<Value, String> {
    let p = &record["baseline"]["profile"];
    let request = json!({"action":action,"root":vault::dir()?.join("Guardian"),"agentScript":AGENT,"hostScript":HOST,
        "config":{"generation":generation(record),"dataRoot":vault::dir()?,"baselineId":record["confirmedAt"],"runtimeId":p["runtimeId"],"virtualRuntime":record["virtualRuntime"],"profile":p,"recover":recover,"recoveryToken":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos().to_string()}});
    powershell::request(
        include_str!("guardian_control.ps1"),
        &request,
        Duration::from_secs(100),
    )
}

pub fn app_action(
    record: &Value,
    operation: &str,
    kind: &str,
    force: bool,
) -> Result<Value, String> {
    let library = STANDARD.encode(include_str!("guardian_agent.ps1"));
    let body=include_str!("guardian_apps.ps1").replace("# GUARDIAN_LIBRARY", &format!(". ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{library}'))))"));
    let args=STANDARD.encode(json!({"profile":record["baseline"]["profile"],"virtualRuntime":record["virtualRuntime"],"operation":operation,"kind":kind,"force":force}).to_string());
    let script=format!("$argsData=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{args}')) | ConvertFrom-Json\n& {{ {body} }} $argsData.profile $argsData.virtualRuntime $argsData.operation $argsData.kind $argsData.force");
    if record["virtualRuntime"] == true {
        return super::hyperv::run(
            "pause_apps",
            json!({"profile":record["baseline"]["profile"],"script":script}),
            None,
        );
    }
    powershell::run_script(
        format!("$result=& {{ {script} }}\n$result | ConvertTo-Json -Depth 15 -Compress")
            .as_bytes(),
    )
}

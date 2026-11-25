use crate::infrastructure::{vault, windows};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
pub fn preferences() -> Result<Value, String> {
    let saved = vault::read("preferences-v1.dpapi")?
        .map(|v| serde_json::from_slice::<Value>(&v).map_err(|e| e.to_string()))
        .transpose()?
        .unwrap_or(json!({"startup":true}));
    let current:Value=windows::run_script(b"$value=(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name CodeSeam -ErrorAction SilentlyContinue).CodeSeam; @{registered=([bool]$value)} | ConvertTo-Json -Compress")?;
    Ok(json!({"startup":saved["startup"],"registered":current["registered"]}))
}
pub fn set_startup(enabled: bool) -> Result<Value, String> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let args = STANDARD.encode(
        json!({"enabled":enabled,"command":format!("\"{}\" --background",executable.display())})
            .to_string(),
    );
    let script=format!("$request=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{args}')) | ConvertFrom-Json\n$key='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; if ($request.enabled) {{ New-Item -Path $key -Force | Out-Null; New-ItemProperty -LiteralPath $key -Name CodeSeam -Value $request.command -PropertyType String -Force | Out-Null }} else {{ Remove-ItemProperty -LiteralPath $key -Name CodeSeam -ErrorAction SilentlyContinue }}; @{{saved=$true}} | ConvertTo-Json -Compress");
    let _: Value = windows::run_script(script.as_bytes())?;
    vault::save(
        "preferences-v1.dpapi",
        &serde_json::to_vec(&json!({"startup":enabled})).map_err(|e| e.to_string())?,
    )?;
    preferences()
}
#[cfg(not(test))]
pub fn initialize() -> Result<(), String> {
    if vault::read("preferences-v1.dpapi")?.is_none() {
        set_startup(true)?;
    }
    Ok(())
}

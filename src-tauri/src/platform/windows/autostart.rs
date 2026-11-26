use super::powershell;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};

pub(crate) fn registered() -> Result<Value, String> {
    powershell::run_script(b"$value=(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name CodeSeam -ErrorAction SilentlyContinue).CodeSeam; @{registered=([bool]$value)} | ConvertTo-Json -Compress")
}

pub(crate) fn set_registered(enabled: bool) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let args = STANDARD.encode(
        json!({"enabled":enabled,"command":format!("\"{}\" --background",executable.display())})
            .to_string(),
    );
    let script=format!("$request=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{args}')) | ConvertFrom-Json\n$key='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; if ($request.enabled) {{ New-Item -Path $key -Force | Out-Null; New-ItemProperty -LiteralPath $key -Name CodeSeam -Value $request.command -PropertyType String -Force | Out-Null }} else {{ Remove-ItemProperty -LiteralPath $key -Name CodeSeam -ErrorAction SilentlyContinue }}; @{{saved=$true}} | ConvertTo-Json -Compress");
    let _: Value = powershell::run_script(script.as_bytes())?;
    Ok(())
}

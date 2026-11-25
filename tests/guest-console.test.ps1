$ErrorActionPreference = 'Stop'
$body = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/infrastructure/guest_browser.ps1'))
# 使用模拟的原生窗口验证编排流程，不修改真实窗口。
$showDefinition = [scriptblock]::Create($body).Ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -eq 'Show-GuestConsole' }
$body = $body.Replace($showDefinition.Extent.Text, '')
$root = $env:TEMP
$recordPath = 'checkpoint.json'
$id = [guid]::NewGuid().ToString()
$fixtureNode = @{id='fixture';exitIp='203.0.113.10'}
$request = @{ action='ensure_ready'; config=@{openConsole=$true;node=$fixtureNode;timezoneTarget=@{windowsId='Singapore Standard Time';ianaId='Asia/Singapore'}} }
$script:launches = 0
$script:closed = 0
$script:removed = 0
$script:visible = $false
$script:showAfterLaunch = $true
$script:wrongTarget = $false
$script:wrongSession = $false
$script:taskResult = 0
$script:ranNow = $true
$script:desktopReady = $true
$script:shown = 0
$script:showFails = $false
$script:minimized = $true
function Show-GuestConsole {
    param($ProcessId)
    if ($ProcessId -ne 1234) { throw 'Wrong console activated' }
    if ($script:showFails) { throw 'Fixture window could not be restored' }
    $script:minimized = $false
    $script:shown++
}
function Get-Content {
    param($LiteralPath, [switch]$Raw)
    if ($LiteralPath -eq $recordPath) { return (@{phase='guest'; deployed=$true; name='candidate'; vmId=$id;node=$fixtureNode} | ConvertTo-Json) }
    return (@{ready=$true; name='candidate'} | ConvertTo-Json)
}
function Get-VM { param($Id) return @{State='Running'} }
function Import-Clixml { param($LiteralPath) return 'credential' }
function New-PSSession { param($VMId,$Credential) return 'session' }
function Test-GuestDesktop { param($Session) return $script:desktopReady }
function Sync-GuestTimezone { param($Session,$Target) if ($Target.windowsId -ne 'Singapore Standard Time') { throw 'Wrong target timezone' }; return 'Singapore Standard Time' }
function Save-Checkpoint { param($Record) }
function Set-Content { param($LiteralPath,$Encoding) process {} }
function Move-Item { param($LiteralPath,$Destination,[switch]$Force) }
function Invoke-Command { param($Session,$ScriptBlock) }
function Remove-PSSession { param($Session) $script:closed++ }
function Test-Path { param($LiteralPath,$PathType) return $true }
function Get-CimInstance {
    param($ClassName,$Filter)
    $targetId = if ($script:wrongTarget) { [guid]::Empty.ToString() } else { $id }
    $sessionId = if ($script:wrongSession) { 2 } else { 1 }
    return @{ProcessId=1234; SessionId=$sessionId; CommandLine=('vmconnect.exe localhost -G ' + $targetId)}
}
function Get-Process {
    param($Id)
    if ($Id -eq $PID) { return @{SessionId=1} }
    return @{Id=1234; MainWindowHandle=$(if ($script:visible) { 42 } else { 0 })}
}
function New-ScheduledTaskAction {
    param($Execute,$Argument)
    if ($Execute -notlike '*vmconnect.exe' -or $Argument -ne ('localhost -G ' + $id)) { throw 'Wrong console target' }
    return 'action'
}
function New-ScheduledTaskPrincipal { param($UserId,$LogonType,$RunLevel) return 'principal' }
function New-ScheduledTaskSettingsSet { param($ExecutionTimeLimit,$MultipleInstances,[switch]$AllowStartIfOnBatteries,[switch]$DontStopIfGoingOnBatteries) return 'settings' }
function Register-ScheduledTask { param($TaskName,$Action,$Principal,$Settings) }
function Start-ScheduledTask {
    param($TaskName)
    $script:launches++
    $script:visible = $script:showAfterLaunch
}
function Get-ScheduledTask { param($TaskName) return @{State='Ready'} }
function Get-ScheduledTaskInfo { param($TaskName) return @{LastRunTime=$(if ($script:ranNow) { [DateTime]::UtcNow } else { [DateTime]::UtcNow.AddYears(-1) }); LastTaskResult=$script:taskResult} }
function Unregister-ScheduledTask { param($TaskName,[switch]$Confirm) $script:removed++ }
function Start-Sleep { param($Milliseconds) }
function Set-GuestConsoleDisplay { param($VmId) if ($VmId -ne $id) { throw 'Wrong display target' } }
$result = & ([scriptblock]::Create($body)) | ConvertFrom-Json
if (!$result.ready -or !$result.consoleOpened -or $result.consoleProcessId -ne 1234 -or $script:launches -ne 1 -or $script:closed -ne 1 -or $script:removed -ne 1 -or $script:shown -ne 1 -or $script:minimized) { throw 'Next must show the target console and release the session/task' }
$script:minimized = $true
$null = & ([scriptblock]::Create($body))
if ($script:launches -ne 1 -or $script:shown -ne 2 -or $script:minimized) { throw 'Existing minimized console must be restored and reused' }
$script:showFails = $true
try { $null = & ([scriptblock]::Create($body)); throw 'Accepted failed window restore' } catch { if ($_.Exception.Message -ne 'Fixture window could not be restored') { throw } }
$script:showFails = $false
$request.config.openConsole = $false
$background = & ([scriptblock]::Create($body)) | ConvertFrom-Json
if ($background.consoleOpened -or $script:launches -ne 1 -or $script:shown -ne 2) { throw 'Background readiness checks must not open or activate a console' }
$request.config.openConsole = $true
$script:desktopReady = $false
$closedBefore = $script:closed
try { $null = & ([scriptblock]::Create($body)); throw 'Accepted missing desktop' } catch { if ($_.Exception.Message -eq 'Accepted missing desktop') { throw } }
if ($script:closed -ne $closedBefore + 1 -or $script:launches -ne 1) { throw 'Missing desktop must close the session without launching a console' }
$script:desktopReady = $true
# Load helpers independently so timeout paths need not wait 20 seconds.
$ast = [scriptblock]::Create($body).Ast
foreach ($definition in $ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -ne 'Show-GuestConsole' }) { . ([scriptblock]::Create($definition.Extent.Text)) }
$script:wrongTarget = $true
if (Find-GuestConsole $id) { throw 'A different VM must not satisfy console readiness' }
$script:wrongTarget = $false
$script:wrongSession = $true
if (Find-GuestConsole $id) { throw 'A different interactive session must not satisfy console readiness' }
$script:wrongSession = $false
$script:visible = $false
$script:showAfterLaunch = $false
try { $null = Open-GuestConsole $id 0; throw 'Accepted missing window' } catch { if ($_.Exception.Message -notlike '*未检测到目标虚拟机的可见窗口*') { throw } }
if ($script:removed -ne 2) { throw 'Window timeout must clean up the task definition' }
$script:taskResult = 5
try { $null = Open-GuestConsole $id 0; throw 'Accepted failed launch' } catch { if ($_.Exception.Message -notlike '*窗口启动失败*') { throw } }
if ($script:removed -ne 3) { throw 'Failed launch must clean up the task definition' }
$script:taskResult = 267011
$script:ranNow = $false
try { $null = Open-GuestConsole $id 0; throw 'Accepted pending task without a window' } catch { if ($_.Exception.Message -notlike '*未检测到目标虚拟机的可见窗口*') { throw } }
'PASS: visible target window, reuse, background checks, desktop gate, wrong VM/session, timeout and launch failure'

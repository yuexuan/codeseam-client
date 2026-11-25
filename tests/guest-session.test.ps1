# 使用模拟 Guest 验证安装函数的输出，不会连接虚拟机或修改系统。
$ErrorActionPreference = 'Stop'
. ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/infrastructure/guest_install.ps1'))))
$root = Join-Path $env:TEMP 'codeseam-session-contract'
$record = [pscustomobject]@{name='candidate'; vmId=[guid]::NewGuid(); deployed=$true;timezoneTarget=@{windowsId='Singapore Standard Time';ianaId='Asia/Singapore'}}
$vm = [pscustomobject]@{State='Running'}
function Write-GuestProgress { param($Index,$Detail,$Status) }
function Test-Path { param($LiteralPath) return $true }
function Import-Clixml { param($LiteralPath) return [pscredential]::new('CodeSeamAgent',(ConvertTo-SecureString 'test-only' -AsPlainText -Force)) }
function Get-VM { param($Id) return $vm }
function New-PSSession { param($VMId,$Credential) return 'guest-session' }
function Test-GuestDesktop { param($Session) return $true }
# 远程调用 ADSI 方法时，成功流可能会输出显式 null 值。
# 保留真实账户辅助函数，以便回归测试覆盖其输出约定。
function Invoke-Command { param($Session,$ScriptBlock) $null; $null }
$result = @(Install-GuestWindows)
if ($result.Count -ne 1 -or $result[0] -ne 'guest-session') {
    throw "Install-GuestWindows must emit only its session; received $($result.Count) items"
}
'PASS: remote account configuration nulls cannot contaminate the returned Guest session'

$script:closed = 0
$script:readTimezone = $false
$script:failure = $null
function Remove-PSSession { param($Session) if ($Session -ne 'guest-session') { throw 'Wrong session closed' }; $script:closed++ }
function Set-Content { param($LiteralPath,$Encoding) process {} }
function Add-Content { param($LiteralPath,$Encoding) process {} }
function Invoke-Command {
    param([ValidateNotNullOrEmpty()][object[]]$Session, $ScriptBlock, $ArgumentList)
    if ($ScriptBlock.ToString().Contains('SetPassword')) { $null; $null; return }
    if ($Session.Count -ne 1 -or $Session[0] -ne 'guest-session') { throw 'Invalid session reached initialization' }
    if ($ScriptBlock.ToString().Contains('Get-TimeZone')) {
        if ($ArgumentList -ne 'Singapore Standard Time' -or !$ScriptBlock.ToString().Contains('Set-TimeZone')) { throw 'Guest timezone must follow selected exit' }
        $script:readTimezone = $true; return 'Singapore Standard Time'
    }
    throw 'END-SESSION-PROBE'
}
try { Initialize-Guest; throw 'Expected probe to stop after reading timezone' } catch {
    if ($_.Exception.Message -ne 'END-SESSION-PROBE') { throw }
}
if (!$script:readTimezone -or $script:tz -ne 'Singapore Standard Time' -or $script:closed -ne 1) {
    throw 'Initialization must read Guest timezone and close the clean session on failure'
}
'PASS: initialization reads the timezone with a clean session and closes it on failure'

function Install-GuestWindows { return $null }
$script:completedSteps = @()
function Write-GuestProgress {
    param($Index,$Detail,$Status)
    if ($Status -eq 'satisfied') { $script:completedSteps += $Index }
}
try { Initialize-Guest; throw 'Missing session must fail initialization' } catch {
    if ($_.Exception.Message -notlike 'Guest *') { throw }
}
if ($script:completedSteps.Count -ne 0 -or $script:closed -ne 1) {
    throw 'A missing session must not mark Windows ready or try to close a nonexistent session'
}
'PASS: missing session fails before reporting the Windows step as satisfied'

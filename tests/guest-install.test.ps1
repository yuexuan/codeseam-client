$ErrorActionPreference = 'Stop'
. ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/infrastructure/guest_install.ps1'))))
$root = Join-Path $env:TEMP 'codeseam-guest-contract'
$record = [pscustomobject]@{ name='candidate'; vmId=[guid]::NewGuid(); config=@{disk=64}; deployed=$false }
$vm = [pscustomobject]@{State='Running';Id=[guid]::NewGuid()}
$script:writes = 0
function Write-GuestProgress { param($Index,$Detail,$Status) }
function Test-Path { param($LiteralPath) return $true }
function Import-Clixml { param($LiteralPath) return [pscredential]::new('CodeSeamAgent',(ConvertTo-SecureString 'test-only' -AsPlainText -Force)) }
function New-VHD { throw 'MUST NOT CREATE OR FORMAT DISKS' }
function Save-VM { param($VM,$Confirm) throw 'state preservation denied' }
function Get-VM { param($Id) return [pscustomobject]@{State='Off'} }
function Assert-Throws($Action,$Message) {
    try { & $Action; throw 'Expected failure was missing' } catch {
        if (!$_.Exception.Message.Contains($Message)) { throw }
    }
}
Assert-Throws { Install-GuestWindows } 'state preservation denied'
function Save-VM { param($VM,$Confirm) }
$vm.State = 'Off'
Assert-Throws { Install-GuestWindows } '检测到中断的系统部署磁盘'
$record.deployed = $true
function Start-VM { param($VM) $script:writes++ }
function Set-GuestDesktopAccount { param($Session) }
function Test-GuestDesktop { param($Session) return $true }
function Invoke-Command { param($Session,$ScriptBlock) return $true }
function New-PSSession { param($VMId,$Credential) return 'guest-session' }
$result = Install-GuestWindows
if ($result -ne 'guest-session' -or $script:writes -ne 1) { throw 'Deployed candidates must resume without touching disks' }
'PASS: denied save preserves disks; interrupted disks never overwritten; deployed candidates resume without repartitioning'

function Import-Clixml { param($LiteralPath) return [pscredential]::new('CodeSeam',(ConvertTo-SecureString 'legacy-only' -AsPlainText -Force)) }
Assert-Throws { Install-GuestWindows } '旧版账户配置'
'PASS: legacy credentials require explicit recreation instead of silently changing desktop authentication'

# 将实际部署和恢复应答文件作为 XML 校验。
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/infrastructure/guest_install.ps1'))
$encodedPassword = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('test-onlyPassword'))
$documents = [regex]::Matches($source, '(?s)\$answer = @"\r?\n(.*?)\r?\n"@')
if ($documents.Count -ne 2) { throw 'Expected deployment and recovery answer documents' }
foreach ($document in $documents) {
    [xml]$answer = $ExecutionContext.InvokeCommand.ExpandString($document.Groups[1].Value)
    $ns = [Xml.XmlNamespaceManager]::new($answer.NameTable)
    $ns.AddNamespace('u', 'urn:schemas-microsoft-com:unattend')
    $auto = $answer.SelectSingleNode('//u:AutoLogon', $ns)
    if ($auto.Username -ne 'CodeSeam' -or $auto.Password.Value -ne '' -or $auto.Password.PlainText -ne 'true' -or [int]$auto.LogonCount -le 1) { throw 'Console auto login must use the passwordless desktop account across restarts' }
}
[xml]$deployment = $ExecutionContext.InvokeCommand.ExpandString($documents[0].Groups[1].Value)
$ns = [Xml.XmlNamespaceManager]::new($deployment.NameTable)
$ns.AddNamespace('u', 'urn:schemas-microsoft-com:unattend')
$desktop = $deployment.SelectSingleNode('//u:LocalAccount[u:Name="CodeSeam"]', $ns)
$agent = $deployment.SelectSingleNode('//u:LocalAccount[u:Name="CodeSeamAgent"]', $ns)
if ($desktop.Password.Value -ne '' -or $desktop.Password.PlainText -ne 'true') { throw 'Desktop account must have no password' }
if ($agent.Password.Value -ne $encodedPassword -or $agent.Password.PlainText -ne 'false') { throw 'Management credential must belong only to the agent' }
'PASS: deployment and OOBE recovery keep console access passwordless; management credentials use a separate account'

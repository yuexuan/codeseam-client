$ErrorActionPreference='Stop'
$systemFolder=[Environment]::GetFolderPath('System')
$env:PSModulePath=Join-Path $systemFolder 'WindowsPowerShell\v1.0\Modules'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (!$admin) {
    $outputPath=Join-Path ([IO.Path]::GetTempPath()) ('codeseam-guardian-' + [guid]::NewGuid().ToString('N') + '.json')
    $body=$MyInvocation.MyCommand.ScriptBlock.ToString()
    $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($request | ConvertTo-Json -Depth 30 -Compress)))
    $quoted=$outputPath.Replace("'","''")
    $wrapper="try { `$request=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$encoded')) | ConvertFrom-Json; & { $body } | Set-Content -LiteralPath '$quoted' -Encoding UTF8 } catch { [IO.File]::WriteAllText('$quoted.err',`$_.Exception.Message); exit 1 }"
    [IO.File]::WriteAllText(($outputPath + '.ps1'),$wrapper,[Text.UTF8Encoding]::new($true))
    try {
        $p=Start-Process (Join-Path $systemFolder 'WindowsPowerShell\v1.0\powershell.exe') -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"' + $outputPath + '.ps1"')) -PassThru
        if (!$p.WaitForExit(90000)) { throw 'Guardian 安装超过 90 秒，请检查管理员授权后重试' }
        $p.Refresh()
        if ($p.ExitCode -ne 0) { $detail=Get-Content -LiteralPath ($outputPath + '.err') -Raw -ErrorAction SilentlyContinue; if ($detail) { throw $detail }; throw 'Guardian 管理员操作失败或授权被取消' }
        Get-Content -LiteralPath $outputPath -Raw
    } finally { Remove-Item -LiteralPath ($outputPath + '.ps1'),$outputPath,($outputPath + '.err') -Force -ErrorAction SilentlyContinue }
    return
}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$base=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'CodeSeam-Guardian'
$root=Join-Path $base $sid
$taskName='CodeSeam-Guardian-Host-' + $sid
function Protect-GuardianDirectory([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        if ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Guardian 后台目录不可为链接' }
    } else { New-Item -ItemType Directory -Path $Path -Force | Out-Null }
    $acl=[Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true,$false)
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    foreach ($identity in @('S-1-5-18','S-1-5-32-544')) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($identity),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
# 仅移除当前用户的旧任务。提权脚本必须位于管理员拥有的父目录，
# 不得放在普通权限用户可替换的目录中。
$legacy=Get-ScheduledTask -TaskName 'CodeSeam-Guardian-Host' -ErrorAction SilentlyContinue
if ($legacy) {
    $owner=try { ([Security.Principal.NTAccount]::new($legacy.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value } catch { [string]$legacy.Principal.UserId }
    if ($owner -eq $sid) { Stop-ScheduledTask -TaskName $legacy.TaskName -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $legacy.TaskName -Confirm:$false -ErrorAction Stop }
}
if ($request.action -eq 'install') {
    Protect-GuardianDirectory $base
    Protect-GuardianDirectory $root
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    [IO.File]::WriteAllText((Join-Path $root 'host.ps1'),$request.hostScript,[Text.UTF8Encoding]::new($true))
    [IO.File]::WriteAllText((Join-Path $root 'agent.ps1'),$request.agentScript,[Text.UTF8Encoding]::new($true))
    [IO.File]::WriteAllText((Join-Path $root 'config.json'),($request.config | ConvertTo-Json -Depth 24),[Text.UTF8Encoding]::new($true))
    $action=New-ScheduledTaskAction -Execute (Join-Path $systemFolder 'WindowsPowerShell\v1.0\powershell.exe') -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $root + '\host.ps1" -Root "' + $root + '"')
    $principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Highest
    $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $principal.UserId) -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName
    @{installed=$true} | ConvertTo-Json -Compress
} elseif ($request.action -eq 'stop') {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    @{stopped=$true} | ConvertTo-Json -Compress
} else { throw '未知 Guardian 操作' }

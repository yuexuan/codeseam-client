param([string]$Root)
$ErrorActionPreference='Stop'
$env:PSModulePath=Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\v1.0\Modules'
Add-Type -AssemblyName System.Security
$config=Get-Content -LiteralPath (Join-Path $Root 'config.json') -Raw | ConvertFrom-Json
$snapshotPath=Join-Path $config.dataRoot 'guardian-v1.dpapi'
$mutex=[Threading.Mutex]::new($false, ('Local\CodeSeam-Guardian-' + $config.runtimeId))
$acquired=$false; $job=$null; $last=$null; $events=@(); $signature=''; $lastAttempt=[DateTime]::MinValue; $previousState='unknown'
function Save-GuardianStatus($Value) {
    $bytes=[Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Depth 28 -Compress))
    $encrypted=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    [IO.File]::WriteAllBytes(($snapshotPath + '.tmp'),$encrypted)
    for ($attempt=0; $attempt -lt 10; $attempt++) {
        try { Move-Item -LiteralPath ($snapshotPath + '.tmp') -Destination $snapshotPath -Force -ErrorAction Stop; return }
        catch { if ($attempt -eq 9) { throw }; Start-Sleep -Milliseconds 100 }
    }
}
function Save-GuardianEvent($Event) {
    $directory=Join-Path $config.dataRoot 'GuardianEvents'
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $Event.epochMs=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $name='event-' + $Event.epochMs.ToString('D16') + '-' + $Event.id + '.dpapi'
    $path=Join-Path $directory $name
    $json=ConvertTo-Json -InputObject @($Event) -Depth 24 -Compress
    $bytes=[Text.Encoding]::UTF8.GetBytes($json)
    [IO.File]::WriteAllBytes(($path + '.tmp'),[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))
    Move-Item -LiteralPath ($path + '.tmp') -Destination $path -Force
    $Event.archived=$true
}
try {
    try { $acquired=$mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $acquired=$true }
    if (!$acquired) { return }
    try {
        $old=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($snapshotPath),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)) | ConvertFrom-Json
        $events=@($old.events | Select-Object -Last 500)
    } catch {}
    do {
        $at=[DateTime]::UtcNow; $vm=$null; $vmState='Running'; $errorText=$null
        try {
            if ($config.virtualRuntime) { $vm=Get-VM -Id ([guid]$config.runtimeId) -ErrorAction Stop; $vmState=[string]$vm.State }
            if ($vmState -eq 'Running' -and (!$job -or $job.State -in @('Failed','Completed','Stopped')) -and ($at-$lastAttempt).TotalSeconds -ge 15) {
                if ($job) { Remove-Job $job -Force; $job=$null }
                $lastAttempt=$at
                $job=Start-Job -ArgumentList $Root,$config -ScriptBlock {
                    param($root,$settings)
                    $ErrorActionPreference='Stop'; $session=$null
                    try {
                        if (!$settings.virtualRuntime) { & (Join-Path $root 'agent.ps1') $settings $root; return }
                        $credential=Import-Clixml -LiteralPath (Join-Path $settings.dataRoot 'Virtual\guest-credential.xml')
                        $session=New-PSSession -VMId $settings.runtimeId -Credential $credential -ErrorAction Stop
                        $body=[IO.File]::ReadAllText((Join-Path $root 'agent.ps1'))
                        $bootstrap=Invoke-Command -Session $session -ArgumentList $settings,$body -ScriptBlock {
                            param($config,$body)
                            $dir='C:\ProgramData\CodeSeam\Guardian'
                            New-Item -ItemType Directory -Path $dir -Force | Out-Null
                            & icacls.exe $dir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
                            if ($LASTEXITCODE -ne 0) { throw 'Guest Guardian 权限设置失败' }
                            $existing=try { Get-Content -LiteralPath "$dir\config.json" -Raw -ErrorAction Stop | ConvertFrom-Json } catch { $null }
                            $task=Get-ScheduledTask -TaskName 'CodeSeam-Guardian' -ErrorAction SilentlyContinue
                            $restarted=$false
                            if (!$existing -or $existing.generation -ne $config.generation -or ($config.recover -and $existing.recoveryToken -ne $config.recoveryToken) -or !$task -or $task.State -ne 'Running') {
                                $networkHash=if ($existing -and $existing.baselineId -eq $config.baselineId -and $existing.networkConfigHash) {$existing.networkConfigHash} else {(Get-FileHash -LiteralPath 'C:\ProgramData\CodeSeam\Network\config.json' -Algorithm SHA256).Hash}
                                $config | Add-Member -NotePropertyName networkConfigHash -NotePropertyValue $networkHash -Force
                                if ($task) { Stop-ScheduledTask -TaskName 'CodeSeam-Guardian' -ErrorAction SilentlyContinue }
                                [IO.File]::WriteAllText("$dir\agent.ps1",$body,[Text.UTF8Encoding]::new($true))
                                [IO.File]::WriteAllText("$dir\config.json",($config | ConvertTo-Json -Depth 24),[Text.UTF8Encoding]::new($true))
                                $runner='& "' + $dir + '\agent.ps1" (Get-Content -LiteralPath "' + $dir + '\config.json" -Raw | ConvertFrom-Json) "' + $dir + '"'
                                [IO.File]::WriteAllText("$dir\run.ps1",$runner,[Text.UTF8Encoding]::new($true))
                                $action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $dir + '\run.ps1"')
                                $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
                                Register-ScheduledTask -TaskName 'CodeSeam-Guardian' -Action $action -Trigger (New-ScheduledTaskTrigger -AtStartup) -User SYSTEM -RunLevel Highest -Settings $settings -Force | Out-Null
                                Start-ScheduledTask -TaskName 'CodeSeam-Guardian'
                                $restarted=$true
                            }
                            @{restarted=$restarted;at=[DateTime]::UtcNow.ToString('o')}
                        }
                        $recoveryAt=if ($bootstrap.restarted) { ([DateTime]$bootstrap.at).ToUniversalTime() } else { [DateTime]::MinValue }
                        do {
                            $result=Invoke-Command -Session $session -ArgumentList $recoveryAt.ToString('o') -ScriptBlock {
                                param($LastRecovery)
                                $ErrorActionPreference='Stop'
                                $now=[DateTime]::UtcNow
                                $lastRecovery=([DateTime]$LastRecovery).ToUniversalTime()
                                $task=Get-ScheduledTask -TaskName 'CodeSeam-Guardian' -ErrorAction Stop
                                $status=$null; $reader=$null
                                try {
                                    # 读取时允许原子替换，避免 Get-Content 的共享标志
                                    # 与持续写入的 Guest 守护任务产生冲突。
                                    $stream=[IO.File]::Open('C:\ProgramData\CodeSeam\Guardian\status.json',[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
                                    $reader=[IO.StreamReader]::new($stream,[Text.Encoding]::UTF8)
                                    $status=$reader.ReadToEnd() | ConvertFrom-Json
                                } catch {} finally { if ($reader) { $reader.Dispose() } }
                                $statusAt=if ($status) { ([DateTime]$status.at).ToUniversalTime() } else { [DateTime]::MinValue }
                                $stale=!$status -or [math]::Abs(($now-$statusAt).TotalSeconds) -ge 60
                                $cooldown=($now-$lastRecovery).TotalSeconds
                                $restart=($task.State -ne 'Disabled') -and (($task.State -ne 'Running' -and $cooldown -ge 15) -or ($task.State -eq 'Running' -and $stale -and $cooldown -ge 60))
                                if ($restart) {
                                    if ($task.State -eq 'Running') { Stop-ScheduledTask -TaskName 'CodeSeam-Guardian' -ErrorAction Stop }
                                    Start-ScheduledTask -TaskName 'CodeSeam-Guardian' -ErrorAction Stop
                                    @{restartedAt=$now.ToString('o');status=$null}
                                } else {
                                    @{restartedAt=$null;status=$(if ($task.State -eq 'Running' -and $statusAt -ge $lastRecovery) {$status} else {$null})}
                                }
                            }
                            if ($result.restartedAt) {
                                $recoveryAt=([DateTime]$result.restartedAt).ToUniversalTime()
                                # 立即使缓存的成功证据失效，后续观测必须由
                                # 重启后的守护任务重新提供。
                                @{generation=$settings.generation;at='1970-01-01T00:00:00Z';state='unknown'} | Write-Output
                            }
                            if ($result.status) { $result.status | Write-Output }
                            Start-Sleep -Seconds 3
                        } while ($true)
                    } finally { if ($session) { Remove-PSSession $session } }
                }
            }
            if ($vmState -ne 'Running') {
                if ($job) { Stop-Job $job; Remove-Job $job -Force; $job=$null }
                $last=$null
            } elseif ($config.virtualRuntime -and $job) {
                $runtimeErrors=@()
                $outputs=@(Receive-Job $job -ErrorAction SilentlyContinue -ErrorVariable runtimeErrors)
                if ($outputs.Count) { $last=$outputs[-1] }
                if ($runtimeErrors.Count) { $errorText=$runtimeErrors[-1].Exception.Message }
            } elseif (!$config.virtualRuntime) {
                $last=try { Get-Content -LiteralPath (Join-Path $Root 'status.json') -Raw -ErrorAction Stop | ConvertFrom-Json } catch { $null }
            }
        } catch { $errorText=$_.Exception.Message; $last=$null; $vmState='Unknown' }
        $guestAt=if ($last) { ([DateTime]$last.at).ToUniversalTime() } else { [DateTime]::MinValue }
        $fresh=$last -and $last.generation -eq $config.generation -and ($at-$guestAt).TotalSeconds -lt 20 -and ($guestAt-$at).TotalSeconds -lt 5
        $state=if ($vmState -ne 'Running') {'offline'} elseif (!$fresh) {'unknown'} else {$last.state}
        $reason=if ($errorText) {$errorText} elseif ($vmState -ne 'Running') { '虚拟机状态：' + $vmState } elseif (!$fresh) {'Guest Guardian 心跳尚未就绪或已过期，应用启动已暂停'} else {$last.error}
        $signatureNext=(@($state,$vmState,$reason, $(if ($fresh) { $last.processes | ConvertTo-Json -Depth 10 -Compress } else {''})) -join '|')
        # 排除观测时间，避免状态未变的巡检反复生成事件。
        $signatureNext=$signatureNext -replace '"observedAt":"[^"]+"','"observedAt":""'
        if ($signatureNext -ne $signature) {
            $events+=@{id=[guid]::NewGuid().ToString('N');at=$at.ToString('o');object=$(if ($state -eq $previousState) {'process'} else {'runtime'});level=$(if ($state -eq 'monitoring') {'success'} else {'warning'});message=$(if ($reason) {$reason} elseif ($state -eq $previousState) {'Claude 进程与子进程覆盖已更新'} else {'Guardian 已复验 Runtime 与进程覆盖'});before=$previousState;after=$state;action=$(if ($state -eq 'locked') {'lock_and_close'} elseif ($state -eq 'monitoring') {'verified'} else {'observe'});runtimeId=$config.runtimeId}
            Save-GuardianEvent $events[-1]
            $previousState=$state
            $events=@($events | Select-Object -Last 500); $signature=$signatureNext
        }
        $result=@{schema=1;heartbeat=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds();at=$at.ToString('o');generation=$config.generation;runtimeId=$config.runtimeId;state=$state;error=$reason;online=[bool]($fresh -and $vmState -eq 'Running');vmState=$vmState;name=$(if ($vm) {$vm.Name} else {'本机 Windows'});cpu=$(if ($vm) {[int]$vm.ProcessorCount} else {$null});memory=$(if ($vm) {[math]::Round($vm.MemoryStartup/1GB,1)} else {$null});processes=$(if ($fresh) {$last.processes} else {$null});checks=$(if ($fresh) {$last.checks} else {@()});exitIp=$(if ($fresh) {$last.exitIp} else {$null});verifiedAt=$(if ($fresh) {$last.verifiedAt} else {$null});limitation=$(if ($fresh) {$last.limitation} else {$null});events=$events}
        Save-GuardianStatus $result
        Start-Sleep -Seconds 3
    } while ($true)
} finally {
    if ($job) { Stop-Job $job; Remove-Job $job -Force }
    if ($acquired) { $mutex.ReleaseMutex() }; $mutex.Dispose()
}

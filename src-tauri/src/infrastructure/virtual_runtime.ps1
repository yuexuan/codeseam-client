$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = $request.root
$recordPath = Join-Path $root 'checkpoint.json'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (!$admin) {
    $outputPath = Join-Path ([IO.Path]::GetTempPath()) ('codeseam-vm-' + [guid]::NewGuid().ToString('N') + '.json')
    $escapedPath = $outputPath.Replace("'", "''")
    $body = $MyInvocation.MyCommand.ScriptBlock.ToString()
    $body = $body.Substring($body.IndexOf("`$ErrorActionPreference = 'Stop'"))
    $requestData = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($request | ConvertTo-Json -Depth 20 -Compress)))
    $wrapped = "`$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$requestData')) | ConvertFrom-Json; & { $body } > '$escapedPath' 2> '$escapedPath.err'"
    $wrapperPath = $outputPath + '.ps1'
    $wrapped | Set-Content -LiteralPath $wrapperPath -Encoding UTF8
    try {
        $process = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $wrapperPath + '"')) -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw (Get-Content -LiteralPath "$outputPath.err" -Raw -ErrorAction SilentlyContinue) }
        Get-Content -LiteralPath $outputPath -Raw
    } catch {
        if ($_.Exception.NativeErrorCode -eq 1223) {
            [Console]::Error.WriteLine('已取消管理员授权，请重新检测后允许 Windows 授权。')
        } else {
            [Console]::Error.WriteLine('管理员授权或虚拟机操作失败：' + $_.Exception.Message)
        }
        exit 1
    }
    finally { Remove-Item -LiteralPath $wrapperPath, $outputPath, "$outputPath.err" -ErrorAction SilentlyContinue }
    return
}
function Save-Checkpoint($record) {
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    $record | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath "$recordPath.tmp" -Encoding UTF8
    Move-Item -LiteralPath "$recordPath.tmp" -Destination $recordPath -Force
}
# GUEST_FUNCTIONS
function Read-Resources {
    $os = Get-CimInstance Win32_OperatingSystem
    $cpu = Get-CimInstance Win32_ComputerSystem
    $drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($root).Substring(0,1))
    $feature = Get-CimInstance Win32_OptionalFeature -Filter "Name='Microsoft-Hyper-V-All'"
    $systemRebootPending = (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') -or (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') -or ($null -ne (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager').PendingFileRenameOperations)
    $featureState = ''
    try { $featureState = [string](Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -ErrorAction Stop).State } catch {}
    $reboot = $featureState -in @('EnablePending','DisablePending')
    $ready = $false
    if ($feature.InstallState -eq 1 -and !$reboot) {
        Import-Module Hyper-V
        $ready = $cpu.HypervisorPresent -eq $true -and (Get-Service vmms).Status -eq 'Running'
        if ($ready) { Get-VMHost -ErrorAction Stop | Out-Null }
    }
    $checkpoint = $null
    if (Test-Path -LiteralPath $recordPath) { $checkpoint = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json }
    $edition = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').EditionID
    $supportedWindows = $edition -match '^(Professional|Enterprise|Education|Server|IoTEnterprise)'
    $processors = @(Get-CimInstance Win32_Processor)
    $hardware = $processors.Count -gt 0 -and @($processors | Where-Object { !$_.SecondLevelAddressTranslationExtensions -or !$_.VirtualizationFirmwareEnabled }).Count -eq 0
    if ($cpu.HypervisorPresent) { $hardware = $true }
    return @{ ready=$ready; reboot=$reboot; systemRebootPending=$systemRebootPending; enabled=($feature.InstallState -eq 1); hardware=$hardware; windows=$supportedWindows; cpu=[int]$cpu.NumberOfLogicalProcessors; memory=[math]::Floor($os.FreePhysicalMemory / 1MB); disk=[math]::Floor($drive.Free / 1GB); switches=@(if ($ready) { Get-VMSwitch | Where-Object SwitchType -eq Internal | Select-Object -ExpandProperty Name }); checkpoint=$checkpoint }
}
try {
    switch ($request.action) {
        'restart' {
            $r = Read-Resources
            if (!$r.reboot) { throw '系统当前未报告需要重启，请重新检测' }
            Save-Checkpoint @{ phase='prepare'; mode='virtual'; config=$request.config }
            & shutdown.exe /r /t 60 /c 'CodeSeam：Hyper-V 配置需要重启，请保存工作。'
            if ($LASTEXITCODE -ne 0) { throw 'Windows 拒绝了重启请求' }
            @{ restarting=$true } | ConvertTo-Json -Compress
        }
        'read' { Read-Resources | ConvertTo-Json -Depth 10 -Compress }
        'enable' {
            $r = Read-Resources
            if (!$r.hardware -or !$r.windows) { throw 'CPU / SLAT 或 BIOS / UEFI 虚拟化未通过，不能启用 Hyper-V' }
            Save-Checkpoint @{ phase='prepare'; config=$request.config; mode='virtual' }
            $result = Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -All -NoRestart
            @{ restartNeeded=[bool]$result.RestartNeeded } | ConvertTo-Json -Compress
        }
        'create' {
            $r = Read-Resources
            if (!$r.ready) { throw 'Hyper-V 功能、服务或管理接口尚未就绪' }
            $c = $request.config
            foreach ($value in @($c.cpu, $c.memory, $c.disk)) { if ($null -eq $value -or [double]$value -ne [math]::Floor([double]$value)) { throw '资源分配必须为整数' } }
            if ($c.name -notmatch '^[\p{L}\p{N}_-]{1,64}$') { throw '名称仅支持字母、数字、下划线与短横线（1–64 字符）' }
            if ($c.cpu -lt 1 -or $c.cpu -gt ($r.cpu - 1) -or $c.memory -lt 4 -or $c.memory -gt ($r.memory - 2) -or $c.disk -lt 40 -or $c.disk -gt ($r.disk - 10)) { throw '资源不足，请为宿主机保留 CPU、2 GB 内存和 10 GB 磁盘' }
            $iso = Get-Item -LiteralPath $c.iso
            if ($iso.PSIsContainer -or $iso.Extension -ne '.iso') { throw '请选择合法授权的 Windows 10 x64 ISO 文件' }
            if ($r.switches -notcontains $c.network) { throw '请选择现有内部虚拟交换机；出口仍需在 Guest 中独立验证' }
            if (Get-VM -Name $c.name -ErrorAction SilentlyContinue) { throw '同名虚拟机已经存在，请更换名称或恢复现有任务' }
            if ($r.checkpoint.phase -eq 'guest') { throw '已有候选虚拟机，请先完成其初始化' }
            $path = Join-Path $root $c.name
            if (Test-Path -LiteralPath $path) { throw '虚拟机目录已存在，请检查上次任务，不会覆盖现有文件' }
            Save-Checkpoint @{ phase='creating'; config=$c; node=$request.node }
            $vm = New-VM -Name $c.name -Generation 2 -MemoryStartupBytes ([long]$c.memory * 1GB) -NewVHDPath (Join-Path $path 'system.vhdx') -NewVHDSizeBytes ([long]$c.disk * 1GB) -Path $path -SwitchName $c.network
            Set-VMProcessor -VM $vm -Count $c.cpu
            Set-VMFirmware -VM $vm -EnableSecureBoot On
            $dvd = Add-VMDvdDrive -VM $vm -Path $iso.FullName -Passthru
            Set-VMFirmware -VM $vm -FirstBootDevice $dvd
            $record = @{ phase='guest'; name=$c.name; vmId=$vm.Id.ToString(); node=$request.node; config=$c }
            Save-Checkpoint $record
            $record | ConvertTo-Json -Depth 10 -Compress
        }
        { $_ -in @('browser_prepare', 'ensure_ready') } {
            # GUEST_BROWSER
        }
        'initialize' {
            $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
            if ($record.phase -ne 'guest') { throw '尚无已创建的候选虚拟机' }
            $taskName = 'CodeSeam-Initialize-' + $record.vmId
            $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
            if ($task -and $task.State -eq 'Running') {
                @{ started=$true } | ConvertTo-Json -Compress
                return
            }
            $progressPath = Join-Path $root 'guest-progress.json'
            if (Test-Path -LiteralPath $progressPath) {
                $progress = Get-Content -LiteralPath $progressPath -Raw | ConvertFrom-Json
                if ($progress.ready -and $progress.desktopSetupVersion -eq 3) { @{ started=$true } | ConvertTo-Json -Compress; return }
            }
            $body = $MyInvocation.MyCommand.ScriptBlock.ToString()
    $body = $body.Substring($body.IndexOf("`$ErrorActionPreference = 'Stop'"))
            $workerRequest = @{ root=$root; action='worker' } | ConvertTo-Json -Compress
            $encodedRequest = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($workerRequest))
            $runner = "`$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$encodedRequest')) | ConvertFrom-Json; & { $body }"
            $workerPath = Join-Path $root 'guest-worker.ps1'
            $runner | Set-Content -LiteralPath $workerPath -Encoding UTF8
            $a = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $workerPath + '"')
            $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Highest
            $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
            Register-ScheduledTask -TaskName $taskName -Action $a -Principal $principal -Settings $settings -Force | Out-Null
            Start-ScheduledTask -TaskName $taskName
            @{ started=$true } | ConvertTo-Json -Compress
        }
        'worker' {
            $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
            $mutex = [Threading.Mutex]::new($false, ('Local\CodeSeam-Guest-' + $record.vmId))
            $acquired = $false
            try {
                try { $acquired = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $acquired = $true }
                if (!$acquired) { return }
                Initialize-Guest
            } finally {
                if ($acquired) { $mutex.ReleaseMutex() }
                $mutex.Dispose()
            }
        }

    }
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }

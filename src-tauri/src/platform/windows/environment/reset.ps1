$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (!$admin -and $request.virtual -and (Test-Path -LiteralPath (Join-Path $request.root 'Virtual\checkpoint.json'))) {
    $outputPath = Join-Path ([IO.Path]::GetTempPath()) ('codeseam-vm-' + [guid]::NewGuid().ToString('N') + '.json')
    $escapedPath = $outputPath.Replace("'", "''")
    $body = $MyInvocation.MyCommand.ScriptBlock.ToString()
    $body = $body.Substring($body.IndexOf("`$ErrorActionPreference = 'Stop'"))
    $requestData = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($request | ConvertTo-Json -Depth 20 -Compress)))
    $wrapped = "`$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$requestData')) | ConvertFrom-Json; & { $body } > '$escapedPath' 2> '$escapedPath.err'"
    $wrapperPath = $outputPath + '.ps1'
    $wrapped | Set-Content -LiteralPath $wrapperPath -Encoding UTF8
    try {
        $process = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $wrapperPath + '"')) -PassThru
        # Start-Process -Wait 会等待全部后代（包括长期打开的 VMConnect）。
        # 此处只等待提权控制器完成，窗口的生命周期独立于本次操作。
        if (!$process.WaitForExit(3500 * 1000)) { $process.Kill(); throw '虚拟环境重置超时，请复核实际状态后重试。' }
        $process.Refresh()
        if ($process.ExitCode -ne 0) {
            $detail = Get-Content -LiteralPath "$outputPath.err" -Raw -ErrorAction SilentlyContinue
            if (![string]::IsNullOrWhiteSpace($detail)) { throw $detail }
            throw ('虚拟机控制器异常退出，退出码：' + $process.ExitCode + '；操作：' + $request.action)
        }
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
$root = [IO.Path]::GetFullPath([string]$request.root).TrimEnd('\')
function Assert-OwnedPath([string]$Path, [string]$Parent) {
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    if (!$full.StartsWith(($Parent.TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw '重置路径超出受管目录' }
    $ancestor = $full
    while ($ancestor.Length -ge $root.Length) {
        if ((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '受管路径含有链接，已停止重置' }
        $ancestor = [IO.Path]::GetDirectoryName($ancestor)
        if (!$ancestor) { break }
    }
    if (Test-Path -LiteralPath $full) {
        $items = @((Get-Item -LiteralPath $full -Force)) + @(Get-ChildItem -LiteralPath $full -Recurse -Force)
        if ($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw '受管目录含有链接，已停止重置以保护外部文件' }
    }
    return $full
}
$native = Join-Path $root 'Browser\native'
if ($request.local) { $native = Assert-OwnedPath $native $root }
$virtual = Join-Path $root 'Virtual'
if ($request.virtual) { $virtual = Assert-OwnedPath $virtual $root }
$backup = if ($request.backup) { Assert-OwnedPath ([string]$request.backup) $root } else { $null }
$vm = $null
$record = $null
$shortcut = $null
if ($request.local -and (Test-Path -LiteralPath $native)) {
    # 仅匹配专用的 user-data-dir 参数，不影响普通浏览器窗口。
    foreach ($kind in @('edge', 'chrome')) {
        $profile = Join-Path $native ($kind + '\User Data')
        $needle = '(?i)--user-data-dir(?:=|\s+)"?' + [regex]::Escape($profile) + '(?:"|\s|$)'
        foreach ($candidate in @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('msedge.exe','chrome.exe') -and $_.CommandLine -match $needle })) {
            Stop-Process -Id $candidate.ProcessId -Force -ErrorAction Stop
        }
    }
    $lockPath = Join-Path $native 'browser.lock'
    $deadline = [DateTime]::UtcNow.AddSeconds(25)
    do {
        $released = $true
        if (Test-Path -LiteralPath $lockPath) {
            try { $handle = [IO.File]::Open($lockPath, 'Open', 'ReadWrite', 'None'); $handle.Dispose() }
            catch { $released = $false; Start-Sleep -Milliseconds 250 }
        }
    } while (!$released -and [DateTime]::UtcNow -lt $deadline)
    if (!$released) { throw '专用浏览器仍在使用，请关闭后重试' }
    $link = Join-Path ([string]$request.desktop) 'Claude (CodeSeam).lnk'
    if (Test-Path -LiteralPath $link) {
        $shell = New-Object -ComObject WScript.Shell
        $target = $shell.CreateShortcut($link)
        if ($target.Arguments.Contains((Join-Path $native 'launcher.ps1'))) { $shortcut = $link }
    }
}
if ($request.virtual -and (Test-Path -LiteralPath (Join-Path $virtual 'checkpoint.json'))) {
    $record = Get-Content -LiteralPath (Join-Path $virtual 'checkpoint.json') -Raw | ConvertFrom-Json
    if (!$record.vmId) { throw '虚拟机创建记录不完整，请先核对 Hyper-V 中的候选虚拟机' }
    Import-Module Hyper-V -ErrorAction Stop
    $vm = Get-VM -Id ([guid]$record.vmId) -ErrorAction SilentlyContinue
    if ($vm) {
        $null = Assert-OwnedPath $vm.Path $virtual
        foreach ($disk in @(Get-VMHardDiskDrive -VM $vm)) { $null = Assert-OwnedPath $disk.Path $virtual }
        $taskName = 'CodeSeam-Initialize-' + $record.vmId
        $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($task) {
            Stop-ScheduledTask -TaskName $taskName
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        }
        if ($vm.State -ne 'Off') { Stop-VM -VM $vm -TurnOff -Force }
    }
}
# 删除任何资源前，先完成所有已请求的备份。
if ($backup) {
    if ($request.local -and (Test-Path -LiteralPath $native)) { Copy-Item -LiteralPath $native -Destination (Join-Path $backup 'native') -Recurse -Force }
    if ($shortcut) { Copy-Item -LiteralPath $shortcut -Destination $backup }
    if ($request.virtual -and (Test-Path -LiteralPath $virtual)) {
        $metadata = New-Item -ItemType Directory -Path (Join-Path $backup 'Virtual') -Force
        Get-ChildItem -LiteralPath $virtual -File -Force | Copy-Item -Destination $metadata.FullName
        if ($vm) { Export-VM -VM $vm -Path (Join-Path $backup 'VMExport') }
        elseif (Get-ChildItem -LiteralPath $virtual -Directory | Where-Object Name -ne 'Images') { throw '虚拟机未注册但磁盘仍存在，请先核对磁盘，未删除' }
    }
    @{schema=1; local=[bool]$request.local; virtual=[bool]$request.virtual; createdAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backup 'reset-manifest.json') -Encoding UTF8
}
if ($request.local) {
    if ($shortcut) { Remove-Item -LiteralPath $shortcut -Force }
    if (Test-Path -LiteralPath $native) { $null = Assert-OwnedPath $native $root; Remove-Item -LiteralPath $native -Recurse -Force }
}
if ($request.virtual -and (Test-Path -LiteralPath $virtual)) {
    if ($vm) { Remove-VM -VM $vm -Force }
    # 安装镜像是可复用的输入文件，不属于已初始化环境。
    foreach ($item in @(Get-ChildItem -LiteralPath $virtual -Force | Where-Object Name -ne 'Images')) {
        $null = Assert-OwnedPath $item.FullName $virtual
        Remove-Item -LiteralPath $item.FullName -Recurse -Force
    }
}
@{completed=$true} | ConvertTo-Json -Compress

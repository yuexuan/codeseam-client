# 只读检测 Hyper-V 兼容性，不会提权或修改系统状态。
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$checks = [Collections.Generic.List[object]]::new()
function Add-Check($id, $label, $value, $status, $detail, $source) {
    $checks.Add([ordered]@{ id=$id; label=$label; value=$value; status=$status; detail=$detail; source=$source; group='runtime'; blocking=($status -eq 'unsupported') })
}
$processors = $null
$system = $null
try { $processors = @(Get-CimInstance Win32_Processor) } catch {}
try { $system = Get-CimInstance Win32_ComputerSystem } catch {}
foreach ($spec in @(
    @('cpu', 'CPU 虚拟化扩展', 'VMMonitorModeExtensions'),
    @('slat', 'SLAT（二级地址转换）', 'SecondLevelAddressTranslationExtensions'),
    @('firmware', 'BIOS / UEFI 虚拟化', 'VirtualizationFirmwareEnabled')
)) {
    $id, $label, $property = $spec
    $value = '无法确认'; $status = 'unknown'
    $detail = '未能读取全部处理器属性；已运行的虚拟机监控程序可能隐藏硬件能力。'
    if ($processors.Count -gt 0 -and @($processors | Where-Object { $null -eq $_.$property }).Count -eq 0) {
        if (@($processors | Where-Object { $_.$property -ne $true }).Count -eq 0) {
            $value = '已支持'; if ($id -eq 'firmware') { $value = '已开启' }; $status = 'satisfied'
            $detail = '所有处理器均报告支持。'
        } elseif ($system -and $system.HypervisorPresent -eq $false) {
            $value = '不支持'; $status = 'unsupported'
            if ($id -eq 'firmware') { $value = '需要开启'; $status = 'pending' }
            $detail = '处理器报告此能力未启用或不支持。固件设置需在 BIOS / UEFI 中检查。'
        }
    }
    if ($status -eq 'unknown' -and $system.HypervisorPresent -eq $true) {
        $value = '监控程序运行中'; $status = 'satisfied'
        $detail = '已检测到运行中的虚拟机监控程序，按运行证据判定兼容；原始 CPU 属性可能被屏蔽。此结果不代表已启用 Hyper-V 完整功能，也不保证虚拟机内的嵌套虚拟化可用。'
        $property = 'HypervisorPresent（间接判断）'
    }
    Add-Check $id $label $value $status $detail "Win32_Processor / Win32_ComputerSystem.$property"
}
try {
    $os = Get-CimInstance Win32_OperatingSystem
    if ($null -eq $system.TotalPhysicalMemory -or $system.TotalPhysicalMemory -le 0 -or $null -eq $os.FreePhysicalMemory) { throw 'Missing memory data' }
    $total = [math]::Round($system.TotalPhysicalMemory / 1GB, 1)
    $free = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
    $status = 'pending'; $value = "$total GiB，内存不足"
    if ($system.TotalPhysicalMemory -gt 16GB) { $status = 'satisfied'; $value = "$total GiB，已满足" }
    Add-Check 'memory' '物理内存' $value $status "总物理内存须 >16 GiB；当前可用 $free GiB。" 'Win32_ComputerSystem.TotalPhysicalMemory / Win32_OperatingSystem.FreePhysicalMemory'
} catch { Add-Check 'memory' '可用内存' '无法确认' 'unknown' '无法读取可用内存。' 'Win32_OperatingSystem' }
try {
    $drive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$env:SystemDrive'"
    if ($null -eq $drive.FreeSpace) { throw 'No disk result' }
    $free = [math]::Round($drive.FreeSpace / 1GB, 1)
    $status = 'pending'; $value = "$free GiB，空间不足"
    if ($drive.FreeSpace -ge 80GB) { $status = 'satisfied'; $value = "$free GiB，已满足" }
    Add-Check 'disk' '可用磁盘' $value $status "系统盘 $env:SystemDrive 可用空间须 ≥80 GiB；创建虚拟机时仍需核对实际存储路径。" 'Win32_LogicalDisk.FreeSpace'
} catch { Add-Check 'disk' '可用磁盘' '无法确认' 'unknown' '无法读取磁盘空间。' 'Win32_LogicalDisk' }
try {
    $edition = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').EditionID
    if ([string]::IsNullOrWhiteSpace($edition)) { throw 'Missing edition' }
    $supported = $edition -match '^(Professional|Enterprise|Education|IoTEnterprise|Server)'
    $status = 'unsupported'; $value = '版本不支持'
    if ($supported -and [Environment]::Is64BitOperatingSystem) { $status = 'satisfied'; $value = '支持情况已读取' }
    Add-Check 'windows' 'Windows 版本' $value $status "Windows EditionID: $edition；Hyper-V 需要受支持的 64 位 Windows 版本。" 'Windows CurrentVersion / EditionID'
} catch { Add-Check 'windows' 'Windows 版本' '无法确认' 'unknown' '无法读取 Windows 版本。' 'Windows CurrentVersion' }
$state = ''
try {
    $feature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All
    $state = [string]$feature.State
    switch ($state) {
        'Enabled' { $value = '已启用'; $status = 'satisfied' }
        'Disabled' { $value = '尚未安装'; $status = 'pending' }
        'DisabledWithPayloadRemoved' { $value = '尚未安装'; $status = 'pending' }
        'EnablePending' { $value = '启用待重启'; $status = 'pending' }
        'DisablePending' { $value = '禁用待重启'; $status = 'pending' }
        default { $value = '无法确认'; $status = 'unknown' }
    }
    Add-Check 'hyperv' 'Hyper-V 功能' $value $status "Windows 功能状态：$state" 'Get-WindowsOptionalFeature'
} catch {
    $featureError = $_.Exception.Message
    try {
        $feature = Get-CimInstance Win32_OptionalFeature -Filter "Name='Microsoft-Hyper-V-All'"
        if ($null -eq $feature.InstallState) { throw 'Missing feature state' }
        $status = 'unknown'; $value = '无法确认'
        switch ([int]$feature.InstallState) {
            1 { $status = 'satisfied'; $value = '已安装' }
            2 { $status = 'pending'; $value = '尚未安装' }
            3 { $status = 'pending'; $value = '安装源不可用' }
        }
        Add-Check 'hyperv' 'Hyper-V 功能' $value $status "CIM 安装状态：$($feature.InstallState)；精确功能查询失败：$featureError。重启状态单独检查。" 'Win32_OptionalFeature.InstallState'
    } catch {
        Add-Check 'hyperv' 'Hyper-V 功能' '无法确认' 'unknown' "功能查询失败：$featureError；CIM 查询失败：$($_.Exception.Message)" 'Get-WindowsOptionalFeature / Win32_OptionalFeature'
    }
}
try {
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    $admin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($admin) { Add-Check 'admin' '管理员权限' '已具备权限' 'satisfied' '当前进程已提升。' 'WindowsPrincipal' }
    else { Add-Check 'admin' '管理员权限' '启用时请求授权' 'optional' '仅在后续启用操作中按需请求管理员授权。' 'WindowsPrincipal' }
} catch { Add-Check 'admin' '管理员权限' '无法确认' 'unknown' '无法读取当前权限上下文。' 'WindowsPrincipal' }
try {
    $hypervRuntime = $false
    $managementDetail = '管理接口尚未验证'
    try {
        $hypervRuntime = $system.HypervisorPresent -eq $true -and (Get-Service vmms -ErrorAction Stop).Status -eq 'Running'
        if ($hypervRuntime) {
            try { Import-Module Hyper-V -ErrorAction Stop; Get-VMHost -ErrorAction Stop | Out-Null; $managementDetail = 'Hyper-V 管理接口查询成功' }
            catch { $managementDetail = '管理接口尚未通过，下一步请求管理员授权后复验' }
        }
    } catch { $managementDetail = 'Hyper-V 服务状态无法确认，下一步复验' }
    $reboot = (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') -or
        (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired')
    $session = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager'
    $reboot = $reboot -or ($null -ne $session.PendingFileRenameOperations)
    $value = '当前无需重启'; $status = 'satisfied'
    $detail = "未发现系统待重启标记；$managementDetail。"
    $featureTransition = $state -in @('EnablePending','DisablePending')
    if ($featureTransition) { $value = 'Hyper-V 变更待重启'; $status = 'pending'; $detail = "Hyper-V 功能明确处于 $state 状态。" }
    elseif ($reboot) {
        $value = '系统有待重启项'; $status = 'optional'
        $detail = "发现通用 Windows 待重启标记，不能据此判定 Hyper-V 必须重启；$managementDetail。"
        if ($hypervRuntime) { $value = 'Hyper-V 已运行，可继续'; $detail = "监控程序与 vmms 已运行；通用待重启标记不阻止继续。$managementDetail。" }
    }
    elseif ($hypervRuntime) { $value = 'Hyper-V 已运行，无需重启' }
    Add-Check 'reboot' '重启状态' $value $status $detail 'Windows reboot markers / HypervisorPresent / vmms / Get-VMHost'
} catch { Add-Check 'reboot' '重启状态' '无法确认' 'unknown' '无法读取重启标记。' 'Windows registry' }
try {
    $running = @(Get-Process | Where-Object { $_.ProcessName -match '^(vmware-vmx|VirtualBoxVM|VBoxHeadless)$' })
    $value = '未发现'; $status = 'satisfied'
    if ($running.Count -gt 0) { $value = '需要核对'; $status = 'pending' }
    Add-Check 'conflict' '虚拟化冲突' $value $status '仅检查正在运行的 VMware / VirtualBox 虚拟机进程；不保证所有版本兼容性。' 'Get-Process'
} catch { Add-Check 'conflict' '虚拟化冲突' '无法确认' 'unknown' '无法读取虚拟机进程。' 'Get-Process' }
ConvertTo-Json -InputObject @($checks.ToArray()) -Depth 5 -Compress

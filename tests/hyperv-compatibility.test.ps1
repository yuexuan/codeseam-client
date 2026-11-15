$ErrorActionPreference = 'Stop'
$script = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/infrastructure/hyperv_compatibility.ps1'), [Text.Encoding]::UTF8)
# 使用隔离的只读测试数据，不调用系统功能管理接口，也不修改设置。
function Get-CimInstance($ClassName, $Filter) {
    switch ($ClassName) {
        'Win32_Processor' { [pscustomobject]@{ VMMonitorModeExtensions=$true; SecondLevelAddressTranslationExtensions=$true; VirtualizationFirmwareEnabled=$false } }
        'Win32_ComputerSystem' { [pscustomobject]@{ HypervisorPresent=$false; TotalPhysicalMemory=32GB } }
        'Win32_OperatingSystem' { [pscustomobject]@{ FreePhysicalMemory=16MB } }
        'Win32_LogicalDisk' { [pscustomobject]@{ FreeSpace=100GB } }
    }
}
function Get-ItemProperty($Path) {
    if ($Path -like '*CurrentVersion') { [pscustomobject]@{ EditionID='Professional' } }
    else { [pscustomobject]@{} }
}
function Test-Path($Path) { $false }
function Get-WindowsOptionalFeature { [pscustomobject]@{ State='Disabled' } }
function Get-Process { @() }
function Assert($condition, $message) { if (-not $condition) { throw $message } }
$report = & ([ScriptBlock]::Create($script)) | ConvertFrom-Json
Assert ($report.Count -eq 10) 'Expected exactly ten checks'
Assert (($report | Where-Object status -eq 'pending').Count -eq 2) 'Only firmware and Hyper-V need action'
Assert (($report | Where-Object id -eq 'memory').status -eq 'satisfied') 'Physical memory above 16 GiB passes'
Assert (($report | Where-Object id -eq 'cpu').status -eq 'satisfied') 'CPU supports virtualization'
function Get-CimInstance($ClassName, $Filter) { throw 'Unavailable' }
function Get-WindowsOptionalFeature { throw 'Access denied' }
$report = & ([ScriptBlock]::Create($script)) | ConvertFrom-Json
Assert (($report | Where-Object id -eq 'cpu').status -eq 'unknown') 'Unavailable CPU data must never pass'
Assert (($report | Where-Object id -eq 'hyperv').status -eq 'unknown') 'Access denied must never become installed or absent'
function Get-ItemProperty($Path) {
    if ($Path -like '*CurrentVersion') { [pscustomobject]@{ EditionID='Core' } }
    else { [pscustomobject]@{} }
}
$report = & ([ScriptBlock]::Create($script)) | ConvertFrom-Json
Assert (($report | Where-Object id -eq 'windows').status -eq 'unsupported') 'Home must be unsupported'
Assert (($report | Where-Object id -eq 'windows').blocking) 'Unsupported edition blocks continuation'
Write-Output 'PASS: 10 checks, action count, unknown observations, denied feature read and unsupported edition'
function Get-CimInstance($ClassName, $Filter) {
    switch ($ClassName) {
        'Win32_ComputerSystem' { [pscustomobject]@{HypervisorPresent=$true; TotalPhysicalMemory=32GB} }
        'Win32_Processor' { [pscustomobject]@{} }
        'Win32_OperatingSystem' { [pscustomobject]@{FreePhysicalMemory=16MB} }
        'Win32_LogicalDisk' { [pscustomobject]@{FreeSpace=100GB} }
    }
}
function Get-ItemProperty($Path) {
    if ($Path -like '*CurrentVersion') { [pscustomobject]@{EditionID='Professional'} }
    else { [pscustomobject]@{PendingFileRenameOperations=@('pending-file')} }
}
function Get-Service { [pscustomobject]@{Status='Running'} }
function Import-Module { }
function Get-VMHost { throw 'Access denied' }
function Get-WindowsOptionalFeature { [pscustomobject]@{State='Enabled'} }
$report = & ([ScriptBlock]::Create($script)) | ConvertFrom-Json
Assert (($report | Where-Object id -eq 'reboot').status -eq 'optional') 'Generic pending file operations must not require a Hyper-V reboot'
Assert (($report | Where-Object id -eq 'reboot').detail -match 'vmms') 'Running services are included in reboot evidence'
function Get-WindowsOptionalFeature { [pscustomobject]@{State='EnablePending'} }
$report = & ([ScriptBlock]::Create($script)) | ConvertFrom-Json
Assert (($report | Where-Object id -eq 'reboot').status -eq 'pending') 'An explicit Hyper-V feature transition must still request reboot'
'PASS: generic reboot marker is advisory; Hyper-V feature transition still requires reboot'

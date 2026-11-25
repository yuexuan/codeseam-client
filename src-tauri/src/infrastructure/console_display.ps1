# 配置每台虚拟机的增强会话设置，并保留现有资源重定向选项。
function Save-GuestConsoleDisplay([string]$VmId, [int]$Width, [int]$Height, [string]$Directory) {
    $id = ([guid]$VmId).ToString()
    $path = Join-Path $Directory ('vmconnect.rdp.' + $id + '.config')
    $document = [xml]::new()
    if (Test-Path -LiteralPath $path) { $document.Load($path) }
    else { $document.LoadXml('<configuration />') }
    $configuration = $document.DocumentElement
    $section = $configuration.SelectSingleNode('Microsoft.Virtualization.Client.RdpOptions')
    if (!$section) {
        $section = $document.CreateElement('Microsoft.Virtualization.Client.RdpOptions')
        $null = $configuration.AppendChild($section)
    }
    $settings = @{
        SaveButtonChecked=@('System.Boolean','True')
        SavedConfigExists=@('System.Boolean','True')
        DesktopSize=@('System.Drawing.Size',($Width.ToString() + ', ' + $Height.ToString()))
    }
    # 默认使用窗口模式并适配当前工作区；保留用户明确设置的全屏偏好。
    foreach ($name in @('FullScreen', 'UseAllMonitors')) {
        if (!$section.SelectSingleNode("setting[@name='$name']")) { $settings[$name] = @('System.Boolean','False') }
    }
    foreach ($name in $settings.Keys) {
        $setting = $section.SelectSingleNode("setting[@name='$name']")
        if (!$setting) {
            $setting = $document.CreateElement('setting')
            $null = $section.AppendChild($setting)
        }
        $setting.SetAttribute('name', $name)
        $setting.SetAttribute('type', $settings[$name][0])
        $value = $setting.SelectSingleNode('value')
        if (!$value) { $value = $document.CreateElement('value'); $null = $setting.AppendChild($value) }
        $value.InnerText = $settings[$name][1]
    }
    $null = [IO.Directory]::CreateDirectory($Directory)
    $document.Save($path + '.tmp')
    Move-Item -LiteralPath ($path + '.tmp') -Destination $path -Force
}
function Set-GuestConsoleDisplay([string]$VmId) {
    Add-Type -AssemblyName System.Windows.Forms
    if (!('CodeSeam.ConsoleDpi' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace CodeSeam {
    public static class ConsoleDpi {
        [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    }
}
'@
    }
    $previous = [CodeSeam.ConsoleDpi]::SetThreadDpiAwarenessContext([IntPtr](-4))
    try {
        $screen = [Windows.Forms.Screen]::PrimaryScreen
        $width = [math]::Max(200, [math]::Min(8192, [int]($screen.WorkingArea.Width * 0.9)))
        $height = [math]::Max(200, [math]::Min(8192, [int]($screen.WorkingArea.Height * 0.85)))
        $directory = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Microsoft\Windows\Hyper-V\Client\1.0'
        Save-GuestConsoleDisplay $VmId $width $height $directory
    } finally {
        if ($previous -ne [IntPtr]::Zero) { $null = [CodeSeam.ConsoleDpi]::SetThreadDpiAwarenessContext($previous) }
    }
}

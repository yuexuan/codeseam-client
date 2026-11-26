$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../src-tauri/src/platform/windows/hyperv/console_display.ps1')
$directory = Join-Path ([IO.Path]::GetTempPath()) ('codeseam-display-' + [guid]::NewGuid().ToString('N'))
$id = [guid]::NewGuid().ToString()
try {
    Save-GuestConsoleDisplay $id 2304 1173 $directory
    $path = Join-Path $directory ('vmconnect.rdp.' + $id + '.config')
    $document = [xml](Get-Content -LiteralPath $path -Raw)
    $section = $document.configuration.'Microsoft.Virtualization.Client.RdpOptions'
    function Value($name) { $section.SelectSingleNode("setting[@name='$name']/value").InnerText }
    if ((Value 'SaveButtonChecked') -ne 'True' -or (Value 'SavedConfigExists') -ne 'True') { throw 'Settings must skip the connection prompt' }
    if ((Value 'DesktopSize') -ne '2304, 1173' -or (Value 'FullScreen') -ne 'False' -or (Value 'UseAllMonitors') -ne 'False') { throw 'Default must fit a single monitor work area' }
    $resource = $document.CreateElement('setting'); $resource.SetAttribute('name','ClipboardRedirection'); $resource.SetAttribute('type','System.Boolean'); $resource.InnerXml='<value>False</value>'; $null=$section.AppendChild($resource)
    $section.SelectSingleNode("setting[@name='FullScreen']/value").InnerText='True'
    $document.Save($path)
    Save-GuestConsoleDisplay $id 1536 864 $directory
    $document = [xml](Get-Content -LiteralPath $path -Raw)
    $section = $document.configuration.'Microsoft.Virtualization.Client.RdpOptions'
    if ((Value 'DesktopSize') -ne '1536, 864' -or (Value 'ClipboardRedirection') -ne 'False' -or (Value 'FullScreen') -ne 'True') { throw 'Screen changes must preserve resource and display mode preferences' }
    'PASS: per-VM settings, automatic resolution refresh, saved preferences and resource preservation'
} finally {
    $resolved = [IO.Path]::GetFullPath($directory)
    if (!$resolved.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'codeseam-display-*') { throw 'Unexpected test directory' }
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
}

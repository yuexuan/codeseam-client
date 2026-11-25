# 使用进程内模拟对象验证原生窗口行为，不修改真实桌面窗口。
$ErrorActionPreference = 'Stop'
$body = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/infrastructure/guest_browser.ps1'))
$definition = [scriptblock]::Create($body).Ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -eq 'Show-GuestConsole' }
Add-Type -TypeDefinition @"
using System;
namespace CodeSeam {
    public static class ConsoleWindow {
        public static bool Minimized = true;
        public static bool Visible = false;
        public static int Command = 0;
        public static uint Flags = 0;
        public static int ForegroundCalls = 0;
        public static bool ShowWindowAsync(IntPtr window, int command) { Command = command; Minimized = false; Visible = true; return true; }
        public static bool IsIconic(IntPtr window) { return Minimized; }
        public static bool IsWindowVisible(IntPtr window) { return Visible; }
        public static bool SetForegroundWindow(IntPtr window) { ForegroundCalls++; return true; }
        public static bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags) { Flags = flags; return true; }
    }
}
"@
. ([scriptblock]::Create($definition.Extent.Text))
$script:handle = [IntPtr]42
function Get-Process { param($Id) if ($Id -ne 1234) { throw 'Wrong process' }; return @{MainWindowHandle=$script:handle} }
Show-GuestConsole 1234
if ([CodeSeam.ConsoleWindow]::Command -ne 9 -or [CodeSeam.ConsoleWindow]::Minimized -or ![CodeSeam.ConsoleWindow]::Visible) { throw 'A minimized window must be restored before reporting success' }
if ([CodeSeam.ConsoleWindow]::Flags -ne 0x4043 -or [CodeSeam.ConsoleWindow]::ForegroundCalls -ne 1) { throw 'The console must be raised without moving or resizing it' }
Show-GuestConsole 1234
if ([CodeSeam.ConsoleWindow]::Command -ne 5 -or [CodeSeam.ConsoleWindow]::ForegroundCalls -ne 2) { throw 'An existing maximized or normal window must retain its size' }
$script:handle = [IntPtr]::Zero
$closed = $false
try { Show-GuestConsole 1234 } catch { $closed = $true }
if (!$closed) { throw 'Accepted closed window' }
'PASS: minimized restore, foreground request, preserved size and closed-window failure'

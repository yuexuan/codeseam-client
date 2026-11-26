$ErrorActionPreference = 'Stop'
$body = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/platform/windows/browser/browser_worker.ps1'))
$ast = [scriptblock]::Create($body).Ast
$opening = $ast.FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst]}, $true) |
    Where-Object { $_.Clauses[0].Item1.Extent.Text -eq '$Mode -ne ''verify''' -and $_.Clauses[0].Item2.Extent.Text.Contains('$url =') } | Select-Object -First 1
if (!$opening) { throw 'Missing interactive launch branch' }
$launchBody = $opening.Clauses[0].Item2.Extent.Text
$launchBody = $launchBody.Substring(1, $launchBody.Length - 2)
foreach ($fn in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('Get-LaunchUrl','Save-LaunchTime','Request-BrowserWindow')}, $false)) {
    . ([scriptblock]::Create($fn.Extent.Text))
}
function Wait-BrowserWindows {}
$manifest = @{executable='fixture.exe'}
$arguments = @('--user-data-dir="fixture-profile"', '--disable-quic')
$ResultPath = ''
$root = Join-Path $env:TEMP ('codeseam-launch-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $root
$script:urls = @()
function Start-Sleep { param($Milliseconds) }
function Start-Process {
    param($FilePath,$ArgumentList,$WindowStyle,[switch]$PassThru)
    if ($FilePath -ne $manifest.executable -or $WindowStyle -ne 'Normal' -or $ArgumentList -notcontains '--user-data-dir="fixture-profile"' -or $ArgumentList -notcontains '--new-window') { throw 'Interactive launch must retain managed profile and visible window' }
    if ($ArgumentList -match '--remote-debugging') { throw 'Interactive launch must not expose debugging' }
    $script:urls += $ArgumentList[-1]
    $process = [pscustomobject]@{Id=123;HasExited=$false}
    $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { return $true }
    return $process
}
foreach ($Mode in @('inspect','open','install_code','install_desktop')) {
    $null = & ([scriptblock]::Create($launchBody))
}
if ($script:urls.Count -ne 4 -or $script:urls[0] -ne 'https://ip.net.coffee/claude/' -or $script:urls[1] -ne 'https://claude.ai/' -or $script:urls[2] -ne 'https://claude.com/product/claude-code' -or $script:urls[3] -ne 'https://claude.ai/download') { throw 'IP inspection and Claude launch destinations must stay separate' }
if (!(Get-Content -LiteralPath (Join-Path $root 'last-launch.json') -Raw | ConvertFrom-Json).at) { throw 'Managed Claude launch timestamp must be recorded' }
$wait = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Wait-BrowserWindows'}, $false)
. ([scriptblock]::Create($wait.Extent.Text))
$activePath = Join-Path $root 'active-browser.json'
$manifest.profileId = 'fixture-profile'
$manifest.nodeId = 'fixture-node'
$browserProcess = [pscustomobject]@{Id=123;Calls=0;HasExited=$false}
$browserProcess | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value {
    $this.Calls++
    $active = Get-Content -LiteralPath $activePath -Raw | ConvertFrom-Json
    $file = Join-Path $root ($active.session + '-fixture.window')
    if ($this.Calls -eq 1) {
        [IO.File]::WriteAllText($file, 'install_desktop')
        return $false
    }
    if (!(Test-Path -LiteralPath "$file.opened")) { throw 'The owner failed to acknowledge the download page' }
    Remove-Item -LiteralPath "$file.opened"
    return $true
}
Wait-BrowserWindows
if ($script:urls.Count -ne 5 -or $script:urls[-1] -ne 'https://claude.ai/download' -or (Test-Path $activePath)) { throw 'Repeat launch must use the same managed browser and release the active session' }
$ticket = [guid]::NewGuid().ToString('N')
@{session=$ticket;nodeId=$manifest.nodeId;profileId=$manifest.profileId;browserProcessId=123} | ConvertTo-Json | Set-Content -LiteralPath $activePath
function Start-Sleep {
    param($Milliseconds)
    $files = [IO.Directory]::GetFiles($root, "$ticket-*.window")
    if ($files.Count -ne 1 -or [IO.File]::ReadAllText($files[0]) -ne 'install_desktop') { throw 'Requester did not publish its selected action' }
    [IO.File]::Move($files[0], $files[0] + '.opened')
}
$Mode = 'install_desktop'
$reused = Request-BrowserWindow
if (!$reused.ok -or $reused.browserProcessId -ne 123 -or [IO.Directory]::GetFiles($root, "$ticket-*").Count) { throw 'Requester failed to acknowledge reuse or clean up' }
Remove-Item -LiteralPath $activePath
Remove-Item -LiteralPath (Join-Path $root 'last-launch.json')
Remove-Item -LiteralPath $root
'PASS: IP inspection, Claude shortcuts and official install entries launch distinct allowlisted URLs in the managed visible browser'

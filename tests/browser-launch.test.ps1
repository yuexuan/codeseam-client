$ErrorActionPreference = 'Stop'
$body = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/infrastructure/browser_worker.ps1'))
$ast = [scriptblock]::Create($body).Ast
$opening = $ast.FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst]}, $true) |
    Where-Object { $_.Clauses[0].Item1.Extent.Text -eq '$Mode -ne ''verify''' -and $_.Clauses[0].Item2.Extent.Text.Contains('$url =') } | Select-Object -First 1
if (!$opening) { throw 'Missing interactive launch branch' }
$launchBody = $opening.Clauses[0].Item2.Extent.Text
$launchBody = $launchBody.Substring(1, $launchBody.Length - 2)
$manifest = @{executable='fixture.exe'}
$arguments = @('--user-data-dir="fixture-profile"', '--disable-quic')
$ResultPath = ''
$script:urls = @()
function Start-Sleep { param($Milliseconds) }
function Start-Process {
    param($FilePath,$ArgumentList,$WindowStyle,[switch]$PassThru)
    if ($FilePath -ne $manifest.executable -or $WindowStyle -ne 'Normal' -or $ArgumentList -notcontains '--user-data-dir="fixture-profile"' -or $ArgumentList -notcontains '--new-window') { throw 'Interactive launch must retain managed profile and visible window' }
    if ($ArgumentList -match '--remote-debugging') { throw 'Interactive launch must not expose debugging' }
    $script:urls += $ArgumentList[-1]
    $process = [pscustomobject]@{Id=123;HasExited=$false}
    $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value {}
    return $process
}
foreach ($Mode in @('inspect','open','install_code','install_desktop')) {
    $null = & ([scriptblock]::Create($launchBody))
}
if ($script:urls.Count -ne 4 -or $script:urls[0] -ne 'https://ip.net.coffee/claude/' -or $script:urls[1] -ne 'https://claude.ai/' -or $script:urls[2] -ne 'https://claude.com/product/claude-code' -or $script:urls[3] -ne 'https://claude.ai/download') { throw 'IP inspection and Claude launch destinations must stay separate' }
'PASS: IP inspection, Claude shortcuts and official install entries launch distinct allowlisted URLs in the managed visible browser'

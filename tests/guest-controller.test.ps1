$ErrorActionPreference = 'Stop'
$controller = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/infrastructure/virtual_runtime.ps1'))
$ast = [scriptblock]::Create($controller).Ast
$elevation = $ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.IfStatementAst] } | Select-Object -First 1
$tryStatement = $elevation.Clauses[0].Item2.Statements | Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] }
$waitBody = $tryStatement.Body.Extent.Text
$waitBody = $waitBody.Substring(1, $waitBody.Length - 2)
$testRoot = Join-Path $env:TEMP ('codeseam-controller-test-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $testRoot
$outputPath = Join-Path $testRoot 'result.json'
$wrapperPath = Join-Path $testRoot 'controller.ps1'
$childPath = Join-Path $testRoot 'child.ps1'
$childIdPath = Join-Path $testRoot 'child-id.txt'
[IO.File]::WriteAllText($childPath, 'Start-Sleep -Seconds 30')
$worker = @'
$child = Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile', '-File', ('"' + $PSScriptRoot + '\child.ps1"')) -PassThru
$child.Id | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'child-id.txt')
'{"ready":true}' | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'result.json')
'@
[IO.File]::WriteAllText($wrapperPath, $worker)
function Start-Process {
    param($FilePath,$Verb,$WindowStyle,$ArgumentList,[switch]$PassThru,[switch]$Wait)
    if ($Wait) { throw 'Elevation must not wait for the whole process tree' }
    Microsoft.PowerShell.Management\Start-Process -FilePath $FilePath -WindowStyle $WindowStyle -ArgumentList $ArgumentList -PassThru
}
try {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $result = & ([scriptblock]::Create($waitBody)) | ConvertFrom-Json
    if (!$result.ready -or $timer.Elapsed.TotalSeconds -ge 15) { throw 'Controller did not return promptly' }
    $childId = [int](Get-Content -LiteralPath $childIdPath -Raw)
    if (!(Get-Process -Id $childId -ErrorAction SilentlyContinue)) { throw 'Console descendant must remain alive after controller completion' }
    'PASS: controller returns while its long-lived descendant stays open'
} finally {
    if (Test-Path -LiteralPath $childIdPath) {
        $childId = [int](Get-Content -LiteralPath $childIdPath -Raw)
        Stop-Process -Id $childId -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $wrapperPath,$childPath,$childIdPath,$outputPath -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $testRoot -ErrorAction SilentlyContinue
}

# Explicit live test only: reads Intl timezone in a disposable browser profile.
$ErrorActionPreference = 'Stop'
$probeRoot = Join-Path ([IO.Path]::GetTempPath()) ('codeseam-timezone-probe-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $probeRoot | Out-Null
$process = $null
try {
    $browser = @(${env:ProgramFiles(x86)}, $env:ProgramFiles) | Where-Object { $_ } | ForEach-Object { Join-Path $_ 'Microsoft\Edge\Application\msedge.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (!$browser) { throw 'Edge is required for this explicit live test' }
    $html = '<html><body><script>document.body.innerHTML="<output>"+Intl.DateTimeFormat().resolvedOptions().timeZone+"</output>"</script></body></html>'
    $url = 'data:text/html;base64,' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($html))
    $stdout = Join-Path $probeRoot 'stdout.txt'
    $process = Start-Process -FilePath $browser -ArgumentList @('--headless=new','--disable-gpu','--no-first-run',('--user-data-dir="' + (Join-Path $probeRoot 'User Data') + '"'),'--dump-dom',$url) -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError (Join-Path $probeRoot 'stderr.txt') -PassThru
    if (!$process.WaitForExit(45000)) { throw 'Browser timezone probe timed out' }
    $dom = Get-Content -LiteralPath $stdout -Raw
    if ($dom -notmatch '<output>([^<]+)</output>') { throw ('Browser did not expose a timezone: ' + $dom) }
    @{timezone=$Matches[1];systemTimezone=(Get-TimeZone).Id} | ConvertTo-Json -Compress
} finally {
    if ($process -and !$process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue; $process.WaitForExit(5000) | Out-Null }
    $resolved = [IO.Path]::GetFullPath($probeRoot)
    $allowedPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\codeseam-timezone-probe-'
    if ($resolved.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue }
}

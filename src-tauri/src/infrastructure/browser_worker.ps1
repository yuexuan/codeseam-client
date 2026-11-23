param([ValidateSet('verify','open','inspect','install_code','install_desktop')][string]$Mode = 'open', [string]$ResultPath)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$browserProcess = $null
$proxyProcess = $null
$socket = $null
$lease = $null
$sessionDir = $null
$outcome = @{ ok=$false; error='浏览器验证未完成' }
function Read-LocalJson([string]$Uri) {
    $http = [Net.HttpWebRequest]::Create($Uri)
    $http.Proxy = $null
    $http.Timeout = 2000
    $response = $http.GetResponse()
    try {
        $reader = [IO.StreamReader]::new($response.GetResponseStream())
        try { return ($reader.ReadToEnd() | ConvertFrom-Json) } finally { $reader.Dispose() }
    } finally { $response.Dispose() }
}
function Invoke-Cdp([string]$Method, $Parameters = @{}, [int]$TimeoutSeconds = 25) {
    $script:messageId++
    $id = $script:messageId
    $payload = [Text.Encoding]::UTF8.GetBytes((@{id=$id; method=$Method; params=$Parameters} | ConvertTo-Json -Depth 12 -Compress))
    $cancel = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($TimeoutSeconds))
    try {
        $socket.SendAsync([ArraySegment[byte]]::new($payload), [Net.WebSockets.WebSocketMessageType]::Text, $true, $cancel.Token).GetAwaiter().GetResult() | Out-Null
        do {
            $stream = [IO.MemoryStream]::new()
            try {
                do {
                    $buffer = New-Object byte[] 16384
                    $received = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), $cancel.Token).GetAwaiter().GetResult()
                    if ($received.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) { throw '浏览器验证通道已关闭' }
                    $stream.Write($buffer, 0, $received.Count)
                    if ($stream.Length -gt 2MB) { throw '浏览器探针响应过大' }
                } while (!$received.EndOfMessage)
                $message = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
            } finally { $stream.Dispose() }
        } while ($message.id -ne $id)
        if ($message.error) { throw ('浏览器探针失败：' + $message.error.message) }
        return $message.result
    } finally { $cancel.Dispose() }
}
try {
    $manifest = Get-Content -LiteralPath (Join-Path $root 'managed-profile.json') -Raw | ConvertFrom-Json
    if ($Mode -ne 'verify' -and $manifest.verificationStatus -ne 'satisfied') { throw '请先在 CodeSeam 中完成当前专用浏览器验证。' }
    $installedVersion = [version](Get-Item -LiteralPath $manifest.executable).VersionInfo.ProductVersion
    if (!$manifest.compatibility -or $manifest.compatibility.status -ne 'satisfied' -or $installedVersion.Major -lt $manifest.compatibility.minimumMajor) { throw '浏览器版本尚未通过校验，请在 CodeSeam 中重新检测并完成升级。' }
    [TimeZoneInfo]::ClearCachedData()
    if (!$manifest.targetWindowsTimezone -or !$manifest.targetTimezone -or (Get-TimeZone).Id -ne $manifest.targetWindowsTimezone) { throw '系统时区与所选代理出口不一致，请在 CodeSeam 中重新同步运行环境并检测浏览器。' }
    if ($Mode -ne 'verify' -and $manifest.timezoneStatus -ne 'satisfied') { throw '浏览器时区尚未通过验证，请关闭专用浏览器后重新检测。' }
    try { $lease = [IO.File]::Open((Join-Path $root 'browser.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw '专用浏览器占用尚未释放，请点击重试以继续验证。' }
    $running = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('--user-data-dir="' + $manifest.profilePath + '"') })
    if ($running.Count) { throw '专用浏览器重新占用了 Profile，请点击重试以自动关闭并继续验证。' }
    # 仅在应用关闭时修改本应用的配置文件，并保留其他所有首选项。
    $defaultProfile = Join-Path $manifest.profilePath 'Default'
    New-Item -ItemType Directory -Path $defaultProfile -Force | Out-Null
    $preferencesPath = Join-Path $defaultProfile 'Preferences'
    $preferences = if (Test-Path -LiteralPath $preferencesPath) { Get-Content -LiteralPath $preferencesPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
    if ((Test-Path -LiteralPath $preferencesPath) -and !(Test-Path -LiteralPath ($preferencesPath + '.codeseam-original'))) { Copy-Item -LiteralPath $preferencesPath -Destination ($preferencesPath + '.codeseam-original') }
    if (!$preferences.webrtc) { $preferences | Add-Member -NotePropertyName webrtc -NotePropertyValue ([pscustomobject]@{}) -Force }
    $preferences.webrtc | Add-Member -NotePropertyName ip_handling_policy -NotePropertyValue 'disable_non_proxied_udp' -Force
    [IO.File]::WriteAllText(($preferencesPath + '.tmp'), ($preferences | ConvertTo-Json -Depth 100 -Compress), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath ($preferencesPath + '.tmp') -Destination $preferencesPath -Force
    $arguments = @(
        ('--user-data-dir="' + $manifest.profilePath + '"'), '--no-first-run', '--no-default-browser-check',
        ('--lang=' + $manifest.language), '--disable-quic',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--disable-features=DnsOverHttps,UseDnsHttpsSvcbAlpn'
    )
    if ($manifest.runtime -eq 'Native') {
        Add-Type -AssemblyName System.Security
        $configBytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $root 'node.dpapi')), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        $node = [Text.Encoding]::UTF8.GetString($configBytes) | ConvertFrom-Json
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
        $listener.Start()
        $port = $listener.LocalEndpoint.Port
        $listener.Stop()
        $sessionDir = Join-Path $root ('proxy-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $sessionDir | Out-Null
        $provider = if ($node.uri) { $node.uri } else { @{proxies=@($node)} | ConvertTo-Json -Depth 30 -Compress }
        [IO.File]::WriteAllText((Join-Path $sessionDir 'selected.yaml'), $provider, [Text.UTF8Encoding]::new($false))
        $config = @{'mixed-port'=$port; 'bind-address'='127.0.0.1'; 'allow-lan'=$false; ipv6=$false; mode='rule'; 'log-level'='silent'; 'proxy-providers'=@{selected=@{type='file';path='selected.yaml'}}; 'proxy-groups'=@(@{name='selected';type='select';use=@('selected')});rules=@('MATCH,selected')}
        [IO.File]::WriteAllText((Join-Path $sessionDir 'config.json'), ($config | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
        $proxyProcess = Start-Process -FilePath $manifest.mihomo -ArgumentList @('-d', ('"' + $sessionDir + '"'), '-f', ('"' + (Join-Path $sessionDir 'config.json') + '"')) -WindowStyle Hidden -PassThru
        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        do {
            $tcp = [Net.Sockets.TcpClient]::new()
            try { $tcp.Connect('127.0.0.1', $port); break } catch { Start-Sleep -Milliseconds 150 } finally { $tcp.Dispose() }
            if ($proxyProcess.HasExited) { throw '专用浏览器代理启动失败' }
        } while ([DateTime]::UtcNow -lt $deadline)
        if ([DateTime]::UtcNow -ge $deadline) { throw '专用浏览器代理启动超时' }
        $arguments += @(('--proxy-server=http://127.0.0.1:' + $port), '--proxy-bypass-list=<-loopback>', '--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost"')
    } else {
        # Guest 全部流量已由受管 TUN 承载；此处复检服务后才允许启动。
        if ((Get-NetAdapter -Name 'CodeSeam-TUN' -ErrorAction Stop).Status -ne 'Up') { throw 'Guest 受管 TUN 未运行' }
        $arguments += '--no-proxy-server'
    }
    if ($Mode -ne 'verify') {
        $url = switch ($Mode) {
            'inspect' { 'https://ip.net.coffee/claude/' }
            'install_code' { 'https://claude.com/product/claude-code' }
            'install_desktop' { 'https://claude.ai/download' }
            default { 'https://claude.ai/' }
        }
        $browserProcess = Start-Process -FilePath $manifest.executable -ArgumentList ($arguments + @('--window-position=100,100','--new-window',$url)) -WindowStyle Normal -PassThru
        Start-Sleep -Milliseconds 700
        if ($browserProcess.HasExited -and $browserProcess.ExitCode -ne 0) { throw '专用浏览器启动失败' }
        if ($ResultPath) {
            @{ok=$true;browserProcessId=$browserProcess.Id} | ConvertTo-Json -Compress | Set-Content -LiteralPath ($ResultPath + '.tmp') -Encoding UTF8
            Move-Item -LiteralPath ($ResultPath + '.tmp') -Destination $ResultPath -Force
        }
        $browserProcess.WaitForExit()
        $outcome = @{ok=$true}
    } else {
        $portFile = Join-Path $manifest.profilePath 'DevToolsActivePort'
        if (Test-Path -LiteralPath $portFile) { Remove-Item -LiteralPath $portFile }
        # 使用完整浏览器；旧版 Edge 的无头模式可能忽略配置文件首选项。
        $browserProcess = Start-Process -FilePath $manifest.executable -ArgumentList ($arguments + @('--start-minimized','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','about:blank')) -WindowStyle Hidden -PassThru
        $deadline = [DateTime]::UtcNow.AddSeconds(25)
        do {
            if (Test-Path -LiteralPath $portFile) {
                try {
                    $debugPort = [int]@(Get-Content -LiteralPath $portFile)[0]
                    $pages = @(Read-LocalJson "http://127.0.0.1:$debugPort/json/list")
                    $page = $pages | Where-Object type -eq 'page' | Select-Object -First 1
                    if ($page.webSocketDebuggerUrl) { break }
                } catch {}
            }
            Start-Sleep -Milliseconds 200
        } while ([DateTime]::UtcNow -lt $deadline)
        if (!$page.webSocketDebuggerUrl) { throw '浏览器未开放本地验证通道；请关闭专用浏览器后重试。' }
        $socket = [Net.WebSockets.ClientWebSocket]::new()
        $socket.Options.Proxy = $null
        $cancel = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(5))
        try { $socket.ConnectAsync([uri]$page.webSocketDebuggerUrl, $cancel.Token).GetAwaiter().GetResult() | Out-Null } finally { $cancel.Dispose() }
        $script:messageId = 0
        $trace = $null
        $navigationErrors = @()
        foreach ($endpoint in @('https://www.cloudflare.com/cdn-cgi/trace','https://speed.cloudflare.com/cdn-cgi/trace')) {
            $navigation = Invoke-Cdp 'Page.navigate' @{url=$endpoint}
            if ($navigation.errorText) { $navigationErrors += $navigation.errorText; continue }
            $deadline = [DateTime]::UtcNow.AddSeconds(22)
            do {
                Start-Sleep -Milliseconds 300
                $body = Invoke-Cdp 'Runtime.evaluate' @{expression='document.body ? document.body.innerText : ""';returnByValue=$true}
                $text = [string]$body.result.value
                if ($text -match '(?m)^ip=([^\r\n]+)') { $trace = $text; break }
            } while ([DateTime]::UtcNow -lt $deadline)
            if ($trace) { break }
        }
        if (!$trace -or $trace -notmatch '(?m)^ip=([^\r\n]+)') { throw ('浏览器 HTTPS 出口检测失败，请检查所选节点后重试。' + ($navigationErrors -join ' / ')) }
        $exitIp = $Matches[1].Trim()
        if ([Net.IPAddress]::Parse($exitIp).ToString() -ne [Net.IPAddress]::Parse($manifest.expectedExitIp).ToString()) { throw "浏览器出口 $exitIp 与所选节点出口不一致，请返回第二步重新测试节点。" }
        $expression = @'
(async () => {
  const permissions = {};
  for (const name of ['camera','microphone','geolocation']) {
    try { permissions[name] = (await navigator.permissions.query({name})).state; }
    catch { permissions[name] = 'unsupported'; }
  }
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl');
  let audio = null;
  try { const ctx = new AudioContext(); audio = ctx.sampleRate; await ctx.close(); } catch {}
  const rtc = await new Promise(async resolve => {
    const pc = new RTCPeerConnection({iceServers:[{urls:'stun:stun.cloudflare.com:3478'}]});
    const candidates = [];
    const finish = complete => { clearTimeout(timer); pc.close(); resolve({complete,candidates}); };
    const timer = setTimeout(() => finish(false), 8000);
    pc.onicecandidate = e => { if (e.candidate) candidates.push(e.candidate.candidate); else finish(true); };
    try { pc.createDataChannel('probe'); await pc.setLocalDescription(await pc.createOffer()); }
    catch { finish(false); }
  });
  return {origin:location.origin, userAgent:navigator.userAgent, language:navigator.language, languages:navigator.languages,
    timezone:Intl.DateTimeFormat().resolvedOptions().timeZone, width:screen.width, height:screen.height,
    canvas:!!document.createElement('canvas').getContext('2d'), webgl:!!gl,
    webglRenderer:gl ? gl.getParameter(gl.RENDERER) : null, audioSampleRate:audio, permissions, rtc};
})()
'@
        $probe = Invoke-Cdp 'Runtime.evaluate' @{expression=$expression;awaitPromise=$true;returnByValue=$true} 30
        if ($probe.exceptionDetails -or !$probe.result.value) { throw '浏览器能力探针未返回有效结果' }
        $observed = $probe.result.value
        if ($observed.timezone -ne $manifest.targetTimezone) { throw ('浏览器实际时区 ' + $observed.timezone + ' 与所选出口时区 ' + $manifest.targetTimezone + ' 不一致，请关闭专用浏览器后重新检测。') }
        if (!$observed.rtc.complete -or @($observed.rtc.candidates).Count -ne 0) { throw ('WebRTC 检测未确认禁止非代理连接：' + ($observed.rtc | ConvertTo-Json -Depth 5 -Compress)) }
        $outcome = @{ok=$true;exitIp=$exitIp;observed=$observed;measuredAt=[DateTime]::UtcNow.ToString('o');network=@{dns=$(if ($manifest.runtime -eq 'Virtual') {'Guest 受管 DNS / TUN'} else {'HTTP 代理远程解析，本地解析已限制'});quic='已禁用';webrtc='无非代理 ICE 候选';ipv6='受管出口 / 运行环境 IPv6 策略'}}
    }
} catch {
    $outcome = @{ok=$false;error=$_.Exception.Message}
    if ($Mode -ne 'verify' -and !$ResultPath) { Add-Type -AssemblyName PresentationFramework; [Windows.MessageBox]::Show($outcome.error, 'CodeSeam 浏览器') | Out-Null }
} finally {
    if ($socket) { $socket.Dispose() }
    if ($Mode -eq 'verify' -and $browserProcess -and !$browserProcess.HasExited) { Stop-Process -Id $browserProcess.Id -ErrorAction SilentlyContinue; $browserProcess.WaitForExit(5000) | Out-Null }
    if ($proxyProcess -and !$proxyProcess.HasExited) { Stop-Process -Id $proxyProcess.Id -ErrorAction SilentlyContinue; $proxyProcess.WaitForExit(5000) | Out-Null }
    if ($sessionDir) {
        # 唯一允许递归清理的目标是此工作进程新建的子目录。
        $resolved = [IO.Path]::GetFullPath($sessionDir)
        if ($resolved.StartsWith([IO.Path]::GetFullPath($root).TrimEnd('\') + '\proxy-', [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue }
    }
    if ($lease) { $lease.Dispose() }
    if ($ResultPath -and ($Mode -eq 'verify' -or !$outcome.ok)) {
        $outcome | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath ($ResultPath + '.tmp') -Encoding UTF8
        Move-Item -LiteralPath ($ResultPath + '.tmp') -Destination $ResultPath -Force
    }
}

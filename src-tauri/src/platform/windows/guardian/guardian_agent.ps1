param($Config, [string]$Root)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
# 在选定 Runtime 内运行，不依赖 WebView 或宿主机界面。
function Write-GuardianJson([string]$Path, $Value) {
    [IO.File]::WriteAllText(($Path + '.tmp'), ($Value | ConvertTo-Json -Depth 24 -Compress), [Text.UTF8Encoding]::new($true))
    for ($attempt=0; $attempt -lt 10; $attempt++) {
        try { Move-Item -LiteralPath ($Path + '.tmp') -Destination $Path -Force -ErrorAction Stop; return }
        catch { if ($attempt -eq 9) { throw }; Start-Sleep -Milliseconds 100 }
    }
}
function Test-GuardianIdentity([string]$Path, [string]$Kind) {
    if (!$Path -or !(Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    if (!$script:identityCache) { $script:identityCache=@{} }
    $file=Get-Item -LiteralPath $Path
    $key=$Path + '|' + $file.LastWriteTimeUtc.Ticks + '|' + $file.Length
    if (!$script:identityCache.ContainsKey($key)) {
        $signature=Get-AuthenticodeSignature -LiteralPath $Path
        $publisher=if ($Kind -eq 'web') {'Microsoft Corporation|Google LLC|Google Inc'} else {'Anthropic'}
        $script:identityCache[$key]=$signature.Status -eq 'Valid' -and $signature.SignerCertificate.Subject -match $publisher
    }
    return [bool]$script:identityCache[$key]
}
function Get-GuardianProcesses($All, [string]$ProfilePath) {
    $desktopPattern = '\\AnthropicClaude\\|\\claude\\app-|\\WindowsApps\\Anthropic'
    $profilePattern = '(?i)--user-data-dir(?:=|\s+)"?' + [regex]::Escape($ProfilePath) + '(?:"|\s|$)'
    $identified = @{}
    foreach ($p in $All) {
        $kind = $null
        if ($p.Name -ieq 'claude.exe' -and $p.ExecutablePath) {
            if ($p.ExecutablePath -match $desktopPattern) { $kind = 'desktop' }
            elseif ($p.ExecutablePath -match '\\\.local\\|\\claude-code\\|\\npm\\') { $kind = 'code' }
        } elseif ($p.Name -ieq 'node.exe' -and $p.CommandLine -match '[\\/]@anthropic-ai[\\/]claude-code[\\/](cli\.js|bin[\\/])') {
            $kind = 'code'
        } elseif ($p.Name -in @('msedge.exe','chrome.exe') -and $p.CommandLine -match $profilePattern) { $kind = 'web' }
        if ($kind) { $identified[[int]$p.ProcessId] = @{kind=$kind; process=$p; root=$true; trusted=(Test-GuardianIdentity $p.ExecutablePath $kind)} }
    }
    # 只遍历已识别 Claude 根进程的后代，不纳入 IDE 或终端父进程。
    do {
        $added = $false
        foreach ($p in $All) {
            $parent = $identified[[int]$p.ParentProcessId]
            if (!$identified.ContainsKey([int]$p.ProcessId) -and $parent -and $p.CreationDate -ge $parent.process.CreationDate) {
                $identified[[int]$p.ProcessId] = @{kind=$parent.kind; process=$p; root=$false; trusted=($parent.trusted -and (Test-GuardianIdentity $p.ExecutablePath $parent.kind))}; $added=$true
            }
        }
    } while ($added)
    foreach ($item in $identified.Values) {
        if ($identified.ContainsKey([int]$item.process.ParentProcessId)) { $item.root=$false }
    }
    return $identified
}
function Stop-GuardianProcesses($Identified, [string]$Kind = '', [bool]$Force = $true) {
    $remaining = @()
    foreach ($entry in @($Identified.Values | Sort-Object { $_.root } -Descending)) {
        if ($Kind -and $entry.kind -ne $Kind) { continue }
        if (!$entry.trusted) { $remaining+=@{id=[int]$entry.process.ProcessId;app=($entry.kind + ' · 身份待确认')}; continue }
        $original = $entry.process
        $live = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$original.ProcessId) -ErrorAction SilentlyContinue
        # 进程 ID 被复用时，不得终止另一个进程。
        if (!$live -or $live.CreationDate -ne $original.CreationDate -or $live.ExecutablePath -ne $original.ExecutablePath) { continue }
        $p = Get-Process -Id $live.ProcessId -ErrorAction SilentlyContinue
        if (!$p) { continue }
        if ($p.MainWindowHandle -ne 0) { $null=$p.CloseMainWindow(); $null=$p.WaitForExit(3000) }
        if (!$p.HasExited) {
            if ($Force) { Stop-Process -Id $p.Id -Force -ErrorAction Stop }
            else { $remaining += @{id=$p.Id; app=$entry.kind} }
        }
    }
    return @($remaining)
}
function Set-GuardianProfileLock($Profile, [bool]$Locked) {
    $path = Join-Path (Split-Path (Split-Path $Profile.profilePath)) 'managed-profile.json'
    $manifest = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ($manifest.profileId -ne $Profile.profileId -or $manifest.runtimeId -ne $Profile.runtimeId) { throw '专用浏览器身份已变化，未修改启动入口' }
    if ($manifest.runtimeLocked -ne $Locked) {
        $manifest | Add-Member -NotePropertyName runtimeLocked -NotePropertyValue $Locked -Force
        Write-GuardianJson $path $manifest
    }
    return $manifest
}
function Test-GuardianRule([string]$Path, [string[]]$Interfaces) {
    if (!$Interfaces.Count -or !$Path -or !(Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    # 按可执行文件限制共享解释器会影响其他应用，因此不采用此隔离方式。
    if ([IO.Path]::GetFileName($Path) -in @('node.exe','powershell.exe','pwsh.exe','cmd.exe','code.exe')) { return $false }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Path.ToLowerInvariant()))).Replace('-','').Substring(0,24) } finally { $sha.Dispose() }
    $name = 'CodeSeam-Guardian-' + $hash
    $rule = Get-NetFirewallRule -PolicyStore ActiveStore -Name $name -ErrorAction SilentlyContinue
    if (!$rule) {
        New-NetFirewallRule -Name $name -DisplayName 'CodeSeam Guardian direct-path block' -Group 'CodeSeam Guardian' -Direction Outbound -Action Block -Program $Path -InterfaceAlias $Interfaces -Profile Any -Enabled True -ErrorAction Stop | Out-Null
    } else {
        $actual = @($rule | Get-NetFirewallInterfaceFilter | Select-Object -ExpandProperty InterfaceAlias)
        if (@(Compare-Object ($Interfaces | Sort-Object) ($actual | Sort-Object)).Count -or $rule.Enabled -ne 'True' -or $rule.Action -ne 'Block' -or $rule.Direction -ne 'Outbound') { throw 'Guardian 网络规则被外部修改，已锁定，未覆盖冲突' }
        if (($rule | Get-NetFirewallApplicationFilter).Program -ine $Path) { throw 'Guardian 规则程序路径冲突' }
    }
    $rule = Get-NetFirewallRule -PolicyStore ActiveStore -Name $name -ErrorAction Stop
    return $rule.Enabled -eq 'True' -and $rule.Action -eq 'Block' -and $rule.Direction -eq 'Outbound'
}
function Get-GuardianHealth($Settings, $Manifest, [bool]$Deep) {
    $checks = @(); $ip = $null
    if ($Settings.virtualRuntime) {
        if ($Settings.networkConfigHash -and (Get-FileHash -LiteralPath 'C:\ProgramData\CodeSeam\Network\config.json' -Algorithm SHA256).Hash -ne $Settings.networkConfigHash) { throw '受管代理配置文件已变化，未覆盖外部冲突' }
        if (@(Get-NetFirewallProfile | Where-Object { !$_.Enabled }).Count) { throw 'Windows 防火墙已停用' }
        if ((Get-ScheduledTask -TaskName 'CodeSeam-Network' -ErrorAction Stop).State -ne 'Running' -or (Get-NetAdapter -Name 'CodeSeam-TUN' -ErrorAction Stop).Status -ne 'Up') { throw 'Guest 代理或 TUN 已停止' }
        if (@(Get-NetAdapterBinding -ComponentID ms_tcpip6 | Where-Object Enabled).Count) { throw 'Guest IPv6 策略已变化' }
        $dns = @(Get-NetAdapter | Where-Object Status -eq Up | Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses.Count })
        if (!$dns.Count -or @($dns | Where-Object { @($_.ServerAddresses | Where-Object { $_ -ne '198.18.0.2' }).Count }).Count) { throw 'Guest DNS 已偏离受管路径' }
        $udp = Get-NetFirewallRule -PolicyStore ActiveStore -Name 'CodeSeam-Block-UDP' -ErrorAction Stop
        if ($udp.Enabled -ne 'True' -or $udp.Action -ne 'Block' -or $udp.Direction -ne 'Outbound') { throw 'Guest UDP 规则失效' }
        $checks += @{id='dns';status='satisfied';label='正常';value='受管 TUN、DNS 与防火墙正在运行'}
        $checks += @{id='network';status='satisfied';label='已启用';value='IPv6 已关闭，受管程序直接出口已阻断'}
    }
    if ((Get-TimeZone).Id -ne $Settings.profile.timezone -or (Get-Culture).Name -ne $Settings.profile.language) { throw '系统时区或语言与正式基线不一致' }
    if ($Manifest.profileId -ne $Settings.profile.profileId -or $Manifest.nodeId -ne $Settings.profile.nodeId -or $Manifest.profilePath -ne $Settings.profile.profilePath) { throw '专用浏览器或节点配置已偏离基线' }
    if ((Get-Item -LiteralPath $Manifest.executable -ErrorAction Stop).VersionInfo.ProductVersion -ne $Settings.profile.version) { throw '专用浏览器版本已变化，请重新验证当前环境并确认基线' }
    $checks += @{id='browser';status='satisfied';label='配置一致';value='专用 Profile、时区与节点配置一致'}
    if ($Deep -and $Settings.virtualRuntime) {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $trace=$null; $lastError=$null
        foreach ($endpoint in @('https://www.cloudflare.com/cdn-cgi/trace','https://speed.cloudflare.com/cdn-cgi/trace')) {
            try { $trace=(Invoke-WebRequest -Uri $endpoint -UseBasicParsing -TimeoutSec 8).Content; break } catch { $lastError=$_.Exception.Message }
        }
        if (!$trace) { throw ('出口暂时无法复验，已暂停应用：' + $lastError) }
        $lines = @($trace -split "`n" | Where-Object { $_.StartsWith('ip=') })
        if ($lines.Count -ne 1) { throw '出口观测缺少唯一 IP' }
        $ip = $lines[0].Substring(3).Trim(); [Net.IPAddress]::Parse($ip) | Out-Null
        if ($ip -ne $Settings.profile.verification.exitIp) { throw ('公网出口已变化：' + $ip + '，需要恢复原节点并重新确认账号') }
    }
    return @{checks=$checks;exitIp=$ip}
}
function Test-GuardianExternalNetwork {
    try {
        if (@(Get-NetAdapterBinding -ComponentID ms_tcpip6 | Where-Object { $_.Name -ne 'CodeSeam-TUN' -and $_.Enabled }).Count) { return $false }
        $dns=@(Get-NetAdapter | Where-Object { $_.Name -ne 'CodeSeam-TUN' -and $_.Status -eq 'Up' } | Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses.Count })
        return $dns.Count -gt 0 -and @($dns | Where-Object { @($_.ServerAddresses | Where-Object { $_ -ne '198.18.0.2' }).Count }).Count -eq 0
    } catch { return $false }
}
function Invoke-GuardianAgent($Settings, [string]$AgentRoot, [switch]$Once) {
    $statusPath = Join-Path $AgentRoot 'status.json'
    $prior = try { Get-Content -LiteralPath $statusPath -Raw -ErrorAction Stop | ConvertFrom-Json } catch { $null }
    $locked = $null; $exitIp=$null; $verifiedAt=$null; $lastDeep=[DateTime]::MinValue; $hasVerified=$false; $stableSince=$null; $startupDeadline=[DateTime]::UtcNow.AddSeconds(60)
    if ($prior -and $prior.generation -eq $Settings.generation -and (!$Settings.recover -or $prior.recoveryApplied -eq $Settings.recoveryToken)) { $locked=$prior.lockReason }
    do {
        $at=[DateTime]::UtcNow; $identified=@{}; $checks=@(); $processes=@{}; $manifest=$null; $coverage=@{}; $all=@(); $healthy=$false; $pendingReason=$null
        try {
            $all = @(Get-CimInstance Win32_Process)
            $identified = Get-GuardianProcesses $all $Settings.profile.profilePath
            $manifest = Get-Content -LiteralPath (Join-Path (Split-Path (Split-Path $Settings.profile.profilePath)) 'managed-profile.json') -Raw | ConvertFrom-Json
            if (!$hasVerified) { $null=Set-GuardianProfileLock $Settings.profile $true }
            $interfaces = @(Get-NetAdapter | Where-Object { $_.Status -ne 'Disabled' -and $_.Name -ne 'CodeSeam-TUN' -and $_.InterfaceDescription -notmatch 'Loopback' } | Select-Object -ExpandProperty Name)
            $paths=@($identified.Values | Where-Object trusted | ForEach-Object { $_.process.ExecutablePath }) + @($manifest.executable)
            $coverage=@{}
            foreach ($path in @($paths | Where-Object { $_ } | Select-Object -Unique)) {
                $coverage[$path] = $Settings.virtualRuntime -and (Test-GuardianRule $path $interfaces)
            }
            if ($Settings.virtualRuntime -and [DateTime]::UtcNow -lt $startupDeadline -and !$locked -and (Get-ScheduledTask -TaskName 'CodeSeam-Network').State -eq 'Running') {
                $tun=Get-NetAdapter -Name 'CodeSeam-TUN' -ErrorAction SilentlyContinue
                if ($tun -and $tun.Status -eq 'Up') {
                    Get-NetAdapterBinding -Name 'CodeSeam-TUN' -ComponentID ms_tcpip6 | Where-Object Enabled | Disable-NetAdapterBinding | Out-Null
                    Set-DnsClientServerAddress -InterfaceIndex $tun.ifIndex -ServerAddresses '198.18.0.2'
                }
            }
            $deep = !$locked -and ($at - $lastDeep).TotalSeconds -ge 60
            $health = Get-GuardianHealth $Settings $manifest $deep
            $checks=$health.checks
            if ($health.exitIp) { $exitIp=$health.exitIp; $verifiedAt=$at.ToString('o') }
            if ($deep) { $lastDeep=$at }
            if (@($identified.Values | Where-Object { !$_.trusted -or !$coverage[$_.process.ExecutablePath] }).Count -and $Settings.virtualRuntime) { throw '存在身份待确认、共享解释器或无法覆盖的 Claude 子进程，已锁定新启动' }
            if (!$stableSince) { $stableSince=[DateTime]::UtcNow }
            $healthy=([DateTime]::UtcNow-$stableSince).TotalSeconds -ge 9
            if ($healthy) { $hasVerified=$true }
            else { $pendingReason='正在等待运行环境稳定，应用启动已暂停' }
            if (!$locked -and $healthy) { $null=Set-GuardianProfileLock $Settings.profile $false }
        } catch {
            $starting=[DateTime]::UtcNow -lt $startupDeadline
            $waitingForStart=!$hasVerified -and $_.Exception.Message -match '代理或 TUN 已停止|No MSFT_NetAdapter|找不到.*CodeSeam-TUN'
            $ownTunRebinding=$_.Exception.Message -match 'Guest DNS 已偏离|Guest IPv6 策略已变化' -and (Test-GuardianExternalNetwork)
            if (!$locked -and $starting -and ($waitingForStart -or $ownTunRebinding)) { $pendingReason='Guest 受管网卡正在连接并复验，应用启动已暂停'; $stableSince=$null }
            elseif (!$locked) { $locked=$_.Exception.Message }
            try { $null=Set-GuardianProfileLock $Settings.profile $true } catch {}
        }
        if ($locked -and $Settings.virtualRuntime) {
            try { $null=Stop-GuardianProcesses $identified } catch { $locked += '；进程关闭未完成：' + $_.Exception.Message }
            # 执行策略后重新扫描，已退出的进程不得保留正常状态。
            $identified = Get-GuardianProcesses @(Get-CimInstance Win32_Process) $Settings.profile.profilePath
        }
        foreach ($kind in @('web','code','desktop')) {
            $entries=@($identified.Values | Where-Object kind -eq $kind)
            $roots=@($entries | Where-Object root)
            $details=@($entries | ForEach-Object {
                $parent=@($all | Where-Object ProcessId -eq $_.process.ParentProcessId | Select-Object -First 1)
                @{id=[int]$_.process.ProcessId; parentId=[int]$_.process.ParentProcessId; root=$_.root; source=$(if ($parent.Count) {$parent[0].Name} else {'Windows'}); covered=($healthy -and !$locked -and $_.trusted -and [bool]$coverage[$_.process.ExecutablePath]); observedAt=$at.ToString('o')}
            })
            $desktopHome = if ($Settings.profile.profilePath -match '^(?<home>.+)\\AppData\\Local\\') { $Matches.home } else { $env:USERPROFILE }
            $installed = switch ($kind) {
                'web' { $true }
                'code' { (Test-Path -LiteralPath (Join-Path $desktopHome '.local\bin\claude.exe')) -or (Test-Path -LiteralPath (Join-Path $desktopHome 'AppData\Roaming\npm\claude.cmd')) }
                'desktop' { Test-Path -LiteralPath (Join-Path $desktopHome 'AppData\Local\AnthropicClaude') }
            }
            $covered = !$locked -and $entries.Count -gt 0 -and @($details | Where-Object { !$_.covered }).Count -eq 0
            $processes[$kind]=@{count=$roots.Count; installed=($installed -or $roots.Count -gt 0); protection=$(if ($covered) {'covered'} elseif ($entries.Count) {'uncovered'} else {'idle'}); instances=$details}
        }
        $state = if ($locked) {'locked'} elseif (!$healthy) {'unknown'} elseif (!$Settings.virtualRuntime) {'limited'} else {'monitoring'}
        $result=@{at=[DateTime]::UtcNow.ToString('o');generation=$Settings.generation;recoveryApplied=$Settings.recoveryToken;online=$true;state=$state;lockReason=$locked;exitIp=$exitIp;verifiedAt=$verifiedAt;checks=$checks;processes=$processes;error=$(if ($locked) {$locked} else {$pendingReason});limitation=$(if (!$Settings.virtualRuntime) {'本机进程网络隔离尚无完整证据，不能声明已受保护'} else {$null})}
        Write-GuardianJson $statusPath $result
        if ($Once) { return $result }
        Start-Sleep -Seconds 3
    } while ($true)
}
if ($Config -and $Root) {
    try { Invoke-GuardianAgent $Config $Root }
    catch {
        [IO.File]::WriteAllText((Join-Path $Root 'last-error.txt'), ($_.Exception.Message + "`n" + $_.ScriptStackTrace), [Text.UTF8Encoding]::new($true))
        throw
    }
}

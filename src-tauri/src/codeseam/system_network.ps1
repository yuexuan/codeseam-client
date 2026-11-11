# 此脚本会编译进 CodeSeam；$Request 是由 Rust 类型化后端提供的已解码 JSON。
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$ipv6Key = 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters'
function Same($a, $b) { return (($a | ConvertTo-Json -Depth 25 -Compress) -ceq ($b | ConvertTo-Json -Depth 25 -Compress)) }
function Addresses($value) { @(([string]$value -split '[,;\s\x00]+') | Where-Object { $_ }) }
function Get-State {
    $bindings = @(Get-NetAdapterBinding -IncludeHidden -AllBindings -ComponentID ms_tcpip6)
    $adapters = @(foreach ($a in Get-NetAdapter -IncludeHidden) {
        $id = $a.InterfaceGuid.ToString().Trim('{}').ToLowerInvariant()
        $b = $bindings | Where-Object { $_.InstanceID -like "{$id}::*" } | Select-Object -First 1
        $dns = @(Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ErrorAction SilentlyContinue)
        if (!$b -and !$dns.Count) { continue }
        $v4key = "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{$id}"
        $v6key = "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters\Interfaces\{$id}"
        $s4 = Get-ItemProperty -LiteralPath $v4key -Name NameServer -ErrorAction SilentlyContinue
        $s6 = Get-ItemProperty -LiteralPath $v6key -Name NameServer -ErrorAction SilentlyContinue
        $enabled = $null; if ($b) { $enabled = [bool]$b.Enabled }
        [pscustomobject]@{ id=$id; index=[int]$a.ifIndex; name=[string]$a.Name; description=[string]$a.InterfaceDescription; status=[string]$a.Status; physical=[bool]$a.HardwareInterface; ipv6Enabled=$enabled; dnsAvailable=($dns.Count -gt 0); dns4=@($dns | Where-Object AddressFamily -eq 2 | ForEach-Object { $_.ServerAddresses }); dns6=@($dns | Where-Object AddressFamily -eq 23 | ForEach-Object { $_.ServerAddresses }); static4=@(Addresses $s4.NameServer); static6=@(Addresses $s6.NameServer) }
    })
    $reg = Get-ItemProperty -LiteralPath $ipv6Key -Name DisabledComponents -ErrorAction SilentlyContinue
    $dohSupported = [bool](Get-Command Get-DnsClientDohServerAddress -ErrorAction SilentlyContinue)
    $doh = @(); if ($dohSupported) { $doh = @(Get-DnsClientDohServerAddress | ForEach-Object { [pscustomobject]@{ server=[string]$_.ServerAddress; template=[string]$_.DohTemplate; autoUpgrade=[bool]$_.AutoUpgrade; fallback=[bool]$_.AllowFallbackToUdp } }) }
    $routes = @(Get-NetRoute -AddressFamily IPv6 -DestinationPrefix '::/0' -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ index=$_.InterfaceIndex; nextHop=$_.NextHop; metric=$_.RouteMetric } })
    $addresses = @(Get-NetIPAddress -AddressFamily IPv6 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^fe80:|^::1$' } | ForEach-Object { [pscustomobject]@{ index=$_.InterfaceIndex; address=$_.IPAddress } })
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    [pscustomobject]@{ adapters=$adapters; ipv6RegistryExists=($null -ne $reg); ipv6RegistryValue=if($reg){[long]$reg.DisabledComponents}else{$null}; ipv6Routes=$routes; ipv6Addresses=$addresses; dohSupported=$dohSupported; doh=$doh; administrator=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); build=[Environment]::OSVersion.Version.Build; bootTime=([DateTimeOffset](Get-CimInstance Win32_OperatingSystem).LastBootUpTime).ToUnixTimeSeconds(); nrptRules=@(Get-DnsClientNrptPolicy -Effective -ErrorAction SilentlyContinue).Count }
}
function Find-Adapter($state, $id) {
    $a = @($state.adapters | Where-Object id -eq $id)
    if ($a.Count -ne 1) { throw "网卡已移除或身份不唯一：$id；请重新检测" }
    $a[0]
}
function Current-Doh($state, $server) { @($state.doh | Where-Object server -eq $server) | Select-Object -First 1 }
function Desired-Doh($server) { [pscustomobject]@{server=$server;template=$Request.profile.template;autoUpgrade=$true;fallback=$false} }
function Check-Guard($state, [bool]$restore) {
    $before = $Request.before
    if(!$restore -and $Request.action -eq 'disable_ipv6') {
        $current=@($state.adapters | Where-Object { $null -ne $_.ipv6Enabled -and $_.status -ne 'Not Present' } | ForEach-Object {$_.id} | Sort-Object)
        if(!(Same $current @($Request.adapterIds | Sort-Object))){throw '可配置网卡列表已变化，请重新检测并预览'}
    }
    foreach($id in $Request.adapterIds) {
        $old=Find-Adapter $before $id; $now=Find-Adapter $state $id
        if($Request.action -eq 'disable_ipv6') {
            if($null -eq $old.ipv6Enabled) { throw '网卡没有可配置的 IPv6 绑定' }
            if($now.ipv6Enabled -ne $old.ipv6Enabled -and !($restore -and $now.ipv6Enabled -eq $false)) { throw "IPv6 配置已被其他程序修改：$($old.name)" }
        } else {
            foreach($family in @('4','6')) {
                $dns='dns'+$family; $static='static'+$family
                $sameOld=(Same @($now.$dns) @($old.$dns)) -and (Same @($now.$static) @($old.$static))
                $desired=@($Request.profile.servers | Where-Object { if($family -eq '4'){$_ -notmatch ':'}else{$_ -match ':'} })
                $sameNew=(Same @($now.$dns) $desired) -and (Same @($now.$static) $desired)
                if(!$sameOld -and !($restore -and $sameNew)) { throw "DNS 配置已变化：$($old.name) IPv$family；停止覆盖，保留备份" }
            }
        }
    }
    if($Request.action -eq 'disable_ipv6') {
        $sameOld=($state.ipv6RegistryExists -eq $before.ipv6RegistryExists -and $state.ipv6RegistryValue -eq $before.ipv6RegistryValue)
        if(!$sameOld -and !($restore -and $state.ipv6RegistryExists -and $state.ipv6RegistryValue -eq 255)) { throw '系统 IPv6 注册表配置已变化，停止覆盖' }
    } elseif($Request.doh) {
        foreach($server in $Request.profile.servers) {
            $old=Current-Doh $before $server; $now=Current-Doh $state $server
            if(!(Same $old $now) -and !($restore -and (Same $now (Desired-Doh $server)))) { throw "DoH 配置已变化：$server" }
        }
    }
}
function Set-Binding($id, [bool]$enabled) {
    $b=@(Get-NetAdapterBinding -IncludeHidden -AllBindings -ComponentID ms_tcpip6 | Where-Object { $_.InstanceID -like "{$id}::*" })
    if($b.Count -ne 1) { throw "无法唯一定位 IPv6 绑定：$id" }
    if($b[0].Enabled -ne $enabled) { Set-NetAdapterBinding -InputObject $b[0] -Enabled $enabled -Confirm:$false | Out-Null }
}
function Set-Doh($server, $value) {
    $existing=Get-DnsClientDohServerAddress -ServerAddress $server -ErrorAction SilentlyContinue
    if($null -eq $value) { if($existing) { Remove-DnsClientDohServerAddress -ServerAddress $server -Confirm:$false }; return }
    if($existing) { Set-DnsClientDohServerAddress -ServerAddress $server -DohTemplate $value.template -AutoUpgrade ([bool]$value.autoUpgrade) -AllowFallbackToUdp ([bool]$value.fallback) }
    else { Add-DnsClientDohServerAddress -ServerAddress $server -DohTemplate $value.template -AutoUpgrade ([bool]$value.autoUpgrade) -AllowFallbackToUdp ([bool]$value.fallback) }
}
function Restore-Settings {
    Check-Guard (Get-State) $true
    if($Request.action -eq 'disable_ipv6') {
        foreach($id in $Request.adapterIds) { $old=Find-Adapter $Request.before $id; Set-Binding $id ([bool]$old.ipv6Enabled) }
        if($Request.before.ipv6RegistryExists) { New-ItemProperty -LiteralPath $ipv6Key -Name DisabledComponents -Value ([long]$Request.before.ipv6RegistryValue) -PropertyType DWord -Force | Out-Null }
        else { Remove-ItemProperty -LiteralPath $ipv6Key -Name DisabledComponents -ErrorAction SilentlyContinue }
    } else {
        foreach($id in $Request.adapterIds) {
            $old=Find-Adapter $Request.before $id; $now=Find-Adapter (Get-State) $id
            foreach($family in @(2,23)) {
                $dns=@(Get-DnsClientServerAddress -InterfaceIndex $now.index -AddressFamily $family)
                if($dns.Count -ne 1) { throw "无法恢复网卡 DNS：$($old.name)" }
                $servers=if($family -eq 2){@($old.static4)}else{@($old.static6)}
                if($servers.Count) { Set-DnsClientServerAddress -InputObject $dns[0] -ServerAddresses $servers -Validate:$false }
                else { Set-DnsClientServerAddress -InputObject $dns[0] -ResetServerAddresses }
            }
        }
        if($Request.doh) { foreach($server in $Request.profile.servers) { Set-Doh $server (Current-Doh $Request.before $server) } }
        Clear-DnsClientCache
    }
}
function Verify-Settings($state, [bool]$restore) {
    foreach($id in $Request.adapterIds) {
        $now=Find-Adapter $state $id; $old=Find-Adapter $Request.before $id
        if($Request.action -eq 'disable_ipv6') {
            $desired=if($restore){[bool]$old.ipv6Enabled}else{$false}
            if($now.ipv6Enabled -ne $desired) { throw "IPv6 绑定复查未通过：$($old.name)" }
        } else {
            foreach($family in @('4','6')) {
                $dns='dns'+$family; $static='static'+$family
                $desired=if($restore){@($old.$static)}else{@($Request.profile.servers | Where-Object { if($family -eq '4'){$_ -notmatch ':'}else{$_ -match ':'} })}
                if(!(Same @($now.$static) $desired)) { throw "DNS 静态/自动配置复查未通过：$($old.name) IPv$family" }
                if((!$restore -or $desired.Count) -and !(Same @($now.$dns) $desired)) { throw "DNS 服务器复查未通过：$($old.name) IPv$family" }
            }
        }
    }
    if($Request.action -eq 'disable_ipv6') {
        if($restore) { if($state.ipv6RegistryExists -ne $Request.before.ipv6RegistryExists -or $state.ipv6RegistryValue -ne $Request.before.ipv6RegistryValue) { throw '系统 IPv6 注册表恢复复查失败' } }
        elseif(!$state.ipv6RegistryExists -or $state.ipv6RegistryValue -ne 255) { throw '系统 IPv6 关闭配置复查失败' }
    } elseif($Request.doh) {
        foreach($server in $Request.profile.servers) {
            $desired=if($restore){Current-Doh $Request.before $server}else{Desired-Doh $server}
            if(!(Same (Current-Doh $state $server) $desired)) { throw "DoH 设置复查失败：$server" }
        }
    }
}
function Probe-Dns {
    $answers=@(); $resolver=@(); $txt=@(); $errorText=$null
    try { $answers=@(Resolve-DnsName www.microsoft.com -Type A -DnsOnly -NoHostsFile -QuickTimeout | Where-Object { $_.Type -eq 1 -and $_.Section -eq 'Answer' } | ForEach-Object { $_.IPAddress }) } catch { $errorText='系统默认 DNS 实际解析失败或超时' }
    try { $txt=@(Resolve-DnsName whoami.ds.akahelp.net -Type TXT -DnsOnly -NoHostsFile -QuickTimeout | Where-Object { $_.Type -eq 16 -and $_.Section -eq 'Answer' } | ForEach-Object { ,@($_.Strings) }); foreach($line in $txt){ if($line.Count -gt 1 -and $line[0] -eq 'ns'){ $resolver += @($line | Select-Object -Skip 1) } } } catch {}
    if(!$resolver.Count) { try { $resolver=@(Resolve-DnsName whoami.akamai.net -Type A -DnsOnly -NoHostsFile -QuickTimeout | Where-Object { $_.Type -eq 1 -and $_.Section -eq 'Answer' -and $_.Name.TrimEnd('.') -eq 'whoami.akamai.net' } | ForEach-Object { $_.IPAddress }) } catch {} }
    [pscustomobject]@{ query='www.microsoft.com'; answers=$answers; resolverEgress=@($resolver | Select-Object -Unique); whoamiTxt=$txt; error=$errorText; source='Windows Resolve-DnsName / Akamai whoami'; note='单次系统默认解析观测，可能使用缓存；递归 DNS 出口不必等于 HTTPS 代理出口' }
}
try {
    if($Request.op -eq 'read') {
        $state=Get-State
        $probe=$null; if($Request.probe){$probe=Probe-Dns}
        [pscustomobject]@{ok=$true;data=[pscustomobject]@{state=$state;probe=$probe}} | ConvertTo-Json -Depth 25 -Compress
        exit 0
    }
    $state=Get-State
    if(!$state.administrator){throw '此操作需要 Windows 管理员权限，请批准 UAC 后重试'}
    if($Request.op -eq 'restore') { Restore-Settings; $after=Get-State; Verify-Settings $after $true; [pscustomobject]@{ok=$true;data=$after;restored=$true} | ConvertTo-Json -Depth 25 -Compress; exit 0 }
    if($Request.op -ne 'apply'){throw '不支持的系统网络操作'}
    if($Request.doh -and !$state.dohSupported){throw '此 Windows 版本不支持原生 DoH，已拒绝加密 DNS 修改'}
    Check-Guard $state $false
    try {
        if($Request.action -eq 'disable_ipv6') {
            foreach($id in $Request.adapterIds){Set-Binding $id $false}
            New-ItemProperty -LiteralPath $ipv6Key -Name DisabledComponents -Value 255 -PropertyType DWord -Force | Out-Null
        } else {
            if($Request.doh){foreach($server in $Request.profile.servers){Set-Doh $server (Desired-Doh $server)}}
            foreach($id in $Request.adapterIds){$a=Find-Adapter $state $id; Set-DnsClientServerAddress -InterfaceIndex $a.index -ServerAddresses @($Request.profile.servers) -Validate:$false}
            Clear-DnsClientCache
        }
        $after=Get-State; Verify-Settings $after $false
        if($Request.action -eq 'set_dns') {
            $probe=Probe-Dns
            if(!$probe.answers.Count){throw '修改后系统 DNS 无法解析，触发回滚'}
        }
        [pscustomobject]@{ok=$true;data=$after;probe=$probe;rebootRequired=($Request.action -eq 'disable_ipv6')} | ConvertTo-Json -Depth 25 -Compress
    } catch {
        $reason=$_.Exception.Message; $rolledBack=$false; $rollbackError=$null
        try {Restore-Settings; Verify-Settings (Get-State) $true; $rolledBack=$true} catch {$rollbackError=$_.Exception.Message}
        [pscustomobject]@{ok=$false;error=$reason;rolledBack=$rolledBack;rollbackError=$rollbackError} | ConvertTo-Json -Depth 25 -Compress
        exit 1
    }
} catch { [pscustomobject]@{ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Depth 10 -Compress; exit 1 }

# 仅更新现有正式虚拟机中的受管网络；保留 Windows 系统和用户数据。
if ($vm.State -in @('Off','Saved')) { Start-VM -VM $vm | Out-Null }
elseif ($vm.State -eq 'Paused') { Resume-VM -VM $vm | Out-Null }
$session = $null
try {
    $credential = Import-Clixml -LiteralPath (Join-Path $root 'guest-credential.xml')
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    $lastError = 'Windows 桌面尚未就绪'
    do {
        try {
            $session = New-PSSession -VMId $record.vmId -Credential $credential -ErrorAction Stop
            if (!(Test-GuestDesktop $session)) { throw 'Windows 桌面尚未就绪' }
            break
        } catch {
            $lastError = $_.Exception.Message
            if ($session) { Remove-PSSession $session; $session = $null }
        }
        Start-Sleep -Seconds 3
    } while ([DateTime]::UtcNow -lt $deadline)
    if (!$session) { throw ('无法连接 Windows 桌面，请打开虚拟机窗口后重试：' + $lastError) }
    $node = $request.config.node
    $nodeConfig = $request.config.nodeConfig
    if (!$node.id -or !$node.exitIp -or !$nodeConfig) { throw '节点配置缺失，请重新选择并测试。' }
    $provider = if ($nodeConfig.uri) { $nodeConfig.uri } else { @{proxies=@($nodeConfig)} | ConvertTo-Json -Depth 30 -Compress }
    $null = Invoke-Command -Session $session -ScriptBlock {
        param($provider, $expectedIp)
        $ErrorActionPreference = 'Stop'
        $dir = 'C:\ProgramData\CodeSeam\Network'
        $path = Join-Path $dir 'selected.yaml'
        $configPath = Join-Path $dir 'config.json'
        $previous = [IO.File]::ReadAllBytes($path)
        $previousConfig = [IO.File]::ReadAllBytes($configPath)
        try {
            Stop-ScheduledTask -TaskName 'CodeSeam-Network' -ErrorAction Stop
            $deadline = [DateTime]::UtcNow.AddSeconds(15)
            while ((Get-ScheduledTask -TaskName 'CodeSeam-Network').State -eq 'Running') {
                if ([DateTime]::UtcNow -ge $deadline) { throw '旧受管代理未退出，请重试。' }
                Start-Sleep -Milliseconds 250
            }
            [IO.File]::WriteAllText(($path + '.tmp'), $provider, [Text.UTF8Encoding]::new($false))
            Move-Item -LiteralPath ($path + '.tmp') -Destination $path -Force
            # TUN 停止后可能残留默认路由。将代理连接绑定到 Guest 的真实上行接口，
            # 避免把 TUN 自身误判为出口。
            $uplink = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop |
                Where-Object { $_.InterfaceAlias -ne 'CodeSeam-TUN' -and $_.NextHop -ne '0.0.0.0' } |
                Sort-Object { [int]$_.RouteMetric + [int](Get-NetIPInterface -InterfaceIndex $_.InterfaceIndex -AddressFamily IPv4 -ErrorAction Stop).InterfaceMetric })
            if (!$uplink.Count) { throw '未找到 Guest 的外部默认网关，请检查虚拟交换机连接。' }
            $config = [Text.Encoding]::UTF8.GetString($previousConfig).TrimStart([char]0xfeff) | ConvertFrom-Json
            if ($config.tun.device -ne 'CodeSeam-TUN' -or !$config.tun.enable) { throw '当前不是 CodeSeam 受管网络配置，已停止修改。' }
            $config | Add-Member -NotePropertyName 'interface-name' -NotePropertyValue $uplink[0].InterfaceAlias -Force
            $config.tun.'auto-detect-interface' = $false
            [IO.File]::WriteAllText(($configPath + '.tmp'), ($config | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
            Move-Item -LiteralPath ($configPath + '.tmp') -Destination $configPath -Force
            & "$dir\mihomo.exe" -t -d $dir -f "$dir\config.json" 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw '新节点配置验证失败' }
            Start-ScheduledTask -TaskName 'CodeSeam-Network' -ErrorAction Stop
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $lastError = '受管代理尚未就绪'
            for ($attempt = 0; $attempt -lt 10; $attempt++) {
                Start-Sleep -Seconds 2
                try {
                    if ((Get-ScheduledTask -TaskName 'CodeSeam-Network').State -ne 'Running') { throw '受管代理未保持运行' }
                    if ((Get-NetAdapter -Name 'CodeSeam-TUN').Status -ne 'Up') { throw '受管 TUN 尚未就绪' }
                    # 重新创建的 TUN 网卡会继承新的 Windows 绑定。
                    Get-NetAdapterBinding -ComponentID ms_tcpip6 -ErrorAction Stop | Where-Object Enabled | Disable-NetAdapterBinding -ErrorAction Stop | Out-Null
                    Get-NetAdapter | Where-Object Status -eq Up | ForEach-Object {
                        Set-DnsClientServerAddress -InterfaceIndex $_.ifIndex -ServerAddresses '198.18.0.2' -ErrorAction Stop
                    }
                    $trace = (Invoke-WebRequest -Uri 'https://www.cloudflare.com/cdn-cgi/trace' -UseBasicParsing -TimeoutSec 12).Content
                    $line = @($trace -split "`n" | Where-Object { $_.StartsWith('ip=') })
                    if ($line.Count -ne 1) { throw '出口检测未返回唯一 IP' }
                    $ip = $line[0].Substring(3).Trim()
                    if ($ip -ne $expectedIp) { throw '实际出口与所选节点不一致' }
                    $null = Resolve-DnsName www.cloudflare.com -DnsOnly -ErrorAction Stop
                    return
                } catch { $lastError = $_.Exception.Message }
            }
            throw ('新节点出口未就绪：' + $lastError)
        } catch {
            $failure = $_
            Stop-ScheduledTask -TaskName 'CodeSeam-Network' -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            [IO.File]::WriteAllBytes($path, $previous)
            [IO.File]::WriteAllBytes($configPath, $previousConfig)
            Start-ScheduledTask -TaskName 'CodeSeam-Network' -ErrorAction SilentlyContinue
            throw $failure
        }
    } -ArgumentList $provider,$node.exitIp -ErrorAction Stop
    $null = Sync-GuestTimezone $session $request.config.timezoneTarget
    $record.node = $node
    $record | Add-Member -NotePropertyName timezoneTarget -NotePropertyValue $request.config.timezoneTarget -Force
    Save-Checkpoint $record
    @{applied=$true; nodeId=$node.id; exitIp=$node.exitIp} | ConvertTo-Json -Compress
} finally { if ($session) { Remove-PSSession $session } }

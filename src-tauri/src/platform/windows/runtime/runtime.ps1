$ErrorActionPreference='Stop'
$checks=[Collections.Generic.List[object]]::new()
function Add($id,$label,$value,$status,$detail,$source) {
 $required=$id -in @('timezone','language','time_sync','dns','ipv6')
 $checks.Add(@{id=$id;group='system';label=$label;value=[string]$value;status=$status;detail=$detail;source=$source;blocking=($required -and $status -ne 'satisfied')})
}
function Probe($id,$label,[scriptblock]$read) {
 try { & $read } catch { Add $id $label '检测失败' 'unknown' $_.Exception.Message 'Windows 系统接口' }
}
Probe 'timezone' '系统时区' {
 $tz=Get-TimeZone
 $status='unknown'; $detail='当前节点的目标时区尚未取得，请重新检测。'
 if($TargetTimezone) {
  $status=if($tz.Id -eq $TargetTimezone){'satisfied'}else{'pending'}
  $detail="节点目标：$TargetTimezone；当前系统：$($tz.Id)"
 }
 Add 'timezone' '系统时区' $tz.Id $status $detail 'Get-TimeZone / 节点目标时区'
}
Probe 'language' '系统语言' {
 $culture=Get-UICulture
 $status=if($culture.TwoLetterISOLanguageName -in @('zh','en')){'satisfied'}else{'pending'}
 Add 'language' '系统语言' "$($culture.NativeName) · $($culture.Name)" $status '运行环境支持中文或 English 显示语言。' 'Get-UICulture'
}
Probe 'culture' '区域格式' {
 Add 'culture' '区域格式' "$((Get-Culture).NativeName) · $((Get-Culture).Name)" 'optional' '区域格式仅供参考，不影响运行环境匹配。' 'Get-Culture'
}
Probe 'time_sync' '时间同步' {
 $service=Get-CimInstance Win32_Service -Filter "Name='W32Time'"
 $enabled=$service.State -eq 'Running' -and $service.StartMode -ne 'Disabled'
 $status=if($enabled){'satisfied'}else{'pending'}
 $value=if($enabled){'已开启'}else{'未开启'}
 Add 'time_sync' '时间同步' $value $status "Windows 时间服务：$($service.State)；启动方式：$($service.StartMode)。匹配条件为服务开启，不代表已实测同步偏差。" 'Win32_Service / W32Time'
}
Probe 'dns' 'DNS 路径' {
 $active=@(Get-NetAdapter -IncludeHidden | Where-Object { $_.Status -eq 'Up' })
 if(!$active.Count){throw '未找到已连接网卡'}
 $trusted=@('1.1.1.1','1.0.0.1','1.1.1.2','1.0.0.2','9.9.9.9','149.112.112.112','8.8.8.8','8.8.4.4','2606:4700:4700::1111','2606:4700:4700::1001','2606:4700:4700::1112','2606:4700:4700::1002','2620:fe::fe','2620:fe::9','2001:4860:4860::8888','2001:4860:4860::8844')
 $dns=@(foreach($a in $active) {
  $v6=@(Get-NetAdapterBinding -IncludeHidden -Name $a.Name -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue | Where-Object Enabled).Count -gt 0
  Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ErrorAction SilentlyContinue | Where-Object { $_.ServerAddresses.Count -gt 0 -and ($_.AddressFamily -eq 2 -or $v6) }
 })
 $servers=@($dns | ForEach-Object { $_.ServerAddresses })
 $untrusted=@($servers | Where-Object { $_ -notin $trusted })
 $nrpt=@(Get-DnsClientNrptPolicy -Effective)
 $answers=@(Resolve-DnsName www.microsoft.com -Type A -DnsOnly -NoHostsFile -QuickTimeout | Where-Object { $_.Type -eq 1 -and $_.Section -eq 'Answer' })
 $ok=$servers.Count -gt 0 -and !$untrusted.Count -and !$nrpt.Count -and $answers.Count -gt 0
 $status=if($ok){'satisfied'}else{'pending'}
 $detail=if($ok){'已连接网卡使用受支持的可信 DNS，系统默认解析成功。'}elseif($nrpt.Count){'存在额外 NRPT 解析策略，请检查策略后重新检测。'}else{'请为已连接网卡设置可信 DNS，并确保系统默认解析成功。'}
 Add 'dns' 'DNS 路径' (($dns | ForEach-Object {"$($_.InterfaceAlias): $($_.ServerAddresses -join ', ')"}) -join '；') $status $detail 'Get-DnsClientServerAddress / Resolve-DnsName / NRPT'
}
Probe 'ipv6' 'IPv6' {
 $adapters=@(Get-NetAdapter -IncludeHidden | Where-Object { $_.Status -ne 'Not Present' })
 $names=@($adapters | ForEach-Object Name)
 $bindings=@(Get-NetAdapterBinding -IncludeHidden -AllBindings -ComponentID ms_tcpip6 | Where-Object { $_.Name -in $names })
 if(!$bindings.Count){throw '未读取到可配置网卡的 IPv6 绑定'}
 $enabled=@($bindings | Where-Object Enabled).Count
 $status=if($enabled -eq 0){'satisfied'}else{'pending'}
 Add 'ipv6' 'IPv6' $(if(!$enabled){'已关闭'}else{"$enabled 个接口已启用"}) $status '匹配条件：全部可配置网卡的 IPv6 绑定均关闭。系统级禁用配置在重启后完全生效。' 'Get-NetAdapterBinding / 全部可配置网卡'
}
Add 'udp' 'UDP / QUIC' '浏览器阶段检测' 'optional' '该项在后续浏览器阶段检测，不参与本机运行环境放行。' '后续阶段'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
ConvertTo-Json -InputObject @($checks.ToArray()) -Depth 6 -Compress

$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::GetEncoding((Get-Culture).TextInfo.OEMCodePage)
$OutputEncoding=[Text.UTF8Encoding]::new($false)
$checks=[Collections.Generic.List[object]]::new()
function Add($id,$group,$label,$value,$status,$detail,$source,[bool]$blocking=$false) {
 $checks.Add([pscustomobject]@{id=$id;group=$group;label=$label;value=[string]$value;status=$status;detail=$detail;source=$source;blocking=$blocking})
}
function Probe($id,$group,$label,$source,[scriptblock]$read) {
 try { & $read } catch { Add $id $group $label '无法读取' 'unknown' $_.Exception.Message $source }
}
Probe 'windows' 'system' 'Windows 版本' 'Win32_OperatingSystem' {
 $os=Get-CimInstance Win32_OperatingSystem
 $ok=[Environment]::Is64BitOperatingSystem -and [version]$os.Version -ge [version]'10.0'
 $status=if($ok){'satisfied'}else{'unsupported'}
 Add 'windows' 'system' 'Windows 版本' "$($os.Caption) · $($os.OSArchitecture)" $status "版本 $($os.Version)，Build $($os.BuildNumber)；最低 Windows 10 64 位" 'Win32_OperatingSystem' (!$ok)
}
Probe 'timezone' 'system' '系统时区' 'Get-TimeZone' {
 $tz=Get-TimeZone; $offset=[DateTimeOffset]::Now.Offset
 Add 'timezone' 'system' '系统时区' "$($tz.Id) (UTC$(if($offset.Ticks -ge 0){'+'}else{'-'})$($offset.Duration().ToString('hh\:mm')))" 'satisfied' "Windows 时区标识；当前夏令时：$($tz.IsDaylightSavingTime([DateTime]::Now))。尚未选定出口，不判断时区匹配。" 'Get-TimeZone / DateTimeOffset'
}
Probe 'language' 'system' '语言' 'Windows culture' {
 $culture=Get-Culture; $languages=@(Get-WinUserLanguageList | ForEach-Object LanguageTag)
 Add 'language' 'system' '语言' $culture.NativeName 'satisfied' "界面：$((Get-UICulture).Name)；首选：$($languages -join ', ')；系统区域：$((Get-WinSystemLocale).Name)；格式：$($culture.Name)" 'Get-Culture / Get-WinUserLanguageList / Get-WinSystemLocale'
}
Probe 'permissions' 'system' '用户权限' 'WindowsPrincipal' {
 $admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
 Add 'permissions' 'system' '用户权限' $(if($admin){'管理员'}else{'普通用户'}) 'satisfied' '预检不需要提权；后续需要修改系统时单独请求权限。' 'WindowsPrincipal'
}
Probe 'disk' 'system' '系统盘空间' 'Win32_LogicalDisk' {
 $disk=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$env:SystemDrive'"
 Add 'disk' 'system' '系统盘空间' "$([math]::Round($disk.FreeSpace/1GB,1)) GB 可用" 'satisfied' "系统盘 $env:SystemDrive；Virtual 所需空间在运行环境阶段判定。" 'Win32_LogicalDisk'
}
Probe 'time_sync' 'system' '时间同步' 'Windows Time / w32tm' {
 $service=Get-Service W32Time
 $out=& w32tm.exe /query /status 2>&1
 if($LASTEXITCODE -eq 0){ Add 'time_sync' 'system' '时间同步' ([string]$service.Status) 'satisfied' ($out -join "`n") 'w32tm /query /status；未执行时钟偏差探测' }
 else { Add 'time_sync' 'system' '时间同步' ([string]$service.Status) 'unknown' "服务状态已读取；无法确认同步来源、最近同步时间及实际偏差。$($out -join ' ')" 'Get-Service W32Time / w32tm' }
}
Probe 'browser' 'apps' 'Claude Web 浏览器' '已安装程序路径' {
 $names=[Collections.Generic.List[string]]::new()
 foreach($base in @($env:ProgramFiles,${env:ProgramFiles(x86)},$env:LOCALAPPDATA)) {
  if(!$base){continue}
  foreach($entry in @(@('Google\Chrome\Application\chrome.exe','Chrome'),@('Microsoft\Edge\Application\msedge.exe','Edge'),@('Mozilla Firefox\firefox.exe','Firefox'))) {
   if(Test-Path -LiteralPath (Join-Path $base $entry[0])){ if(!$names.Contains($entry[1])){$names.Add($entry[1])} }
  }
 }
 if($names.Count){Add 'browser' 'apps' 'Claude Web 浏览器' ($names -join ' / ') 'satisfied' '仅确认程序存在；尚未创建专用环境或验证 Web 网络路径。' '已安装程序路径'}
 else {Add 'browser' 'apps' 'Claude Web 浏览器' '未检测到' 'pending' '浏览器准备将在第五步完成。' '已安装程序路径'}
}
Probe 'code' 'apps' 'Claude Code' 'Get-Command claude' {
 $command=Get-Command claude -ErrorAction SilentlyContinue
 if($command){Add 'code' 'apps' 'Claude Code' '已安装' 'satisfied' '仅确认命令存在；未执行 Claude，也未验证运行路径。' 'Get-Command claude'}
 else {Add 'code' 'apps' 'Claude Code' '尚未安装' 'pending' '第六步提供官方安装入口；不阻塞环境预检。' 'Get-Command claude'}
}
Probe 'desktop' 'apps' 'Claude Desktop' 'Windows app inventory' {
 $apps=@(Get-AppxPackage -Name '*Claude*')
 $installed=$apps.Count -gt 0 -or (Test-Path -LiteralPath "$env:LOCALAPPDATA\AnthropicClaude\Claude.exe") -or (Test-Path -LiteralPath "$env:LOCALAPPDATA\Programs\Claude\Claude.exe")
 if($installed){Add 'desktop' 'apps' 'Claude Desktop' '已安装' 'satisfied' '仅确认安装；未启动或验证网络路径。' 'Get-AppxPackage / 已知安装路径'}
 else {Add 'desktop' 'apps' 'Claude Desktop' '未在已知路径发现' 'unknown' '已检查 Windows 安装包与已知目录，不能排除自定义安装路径。' 'Get-AppxPackage / 已知安装路径'}
}
Probe 'connection' 'network' '网络连接' 'Get-NetConnectionProfile' {
 $profiles=@(Get-NetConnectionProfile)
 $internet=@($profiles|Where-Object { $_.IPv4Connectivity -eq 'Internet' -or $_.IPv6Connectivity -eq 'Internet' })
 if($internet.Count){Add 'connection' 'network' '网络连接' '系统报告可用' 'satisfied' 'Windows 连通性报告；未验证 Claude 服务、受管出口或平台地区资格。' 'Get-NetConnectionProfile'}
 else {Add 'connection' 'network' '网络连接' '未确认互联网访问' 'unknown' '本机预检可离线执行；联网项目留待节点测试。' 'Get-NetConnectionProfile'}
}
Probe 'proxy' 'network' '代理服务' 'Get-Process mihomo/clash' {
 $processes=@(Get-Process -Name mihomo,clash,'clash-meta' -ErrorAction SilentlyContinue)
 if($processes.Count){Add 'proxy' 'network' '代理服务' '发现运行进程' 'unknown' '进程存在不代表可复用；尚未确认控制权限、配置归属或可用性。' 'Get-Process mihomo/clash'}
 else {Add 'proxy' 'network' '代理服务' '尚未发现' 'pending' '第二步准备代理服务，预检不会启动核心或修改全局代理。' 'Get-Process mihomo/clash'}
}
Probe 'dns' 'network' 'DNS 与 IPv6' 'Windows network configuration' {
 $dns=@(Get-DnsClientServerAddress | Where-Object {$_.ServerAddresses.Count -gt 0})
 $v6=@(Get-NetAdapterBinding -ComponentID ms_tcpip6 | Where-Object Enabled)
 Add 'dns' 'network' 'DNS 与 IPv6' "$($dns.Count) 组 DNS · $($v6.Count) 个 IPv6 绑定" 'satisfied' '仅读取配置，未验证 DNS/IPv6/UDP 实际路径，无受管出口基准。' 'Get-DnsClientServerAddress / Get-NetAdapterBinding'
}
Probe 'hyperv' 'runtime' 'Hyper-V' 'Win32_ComputerSystem / optional feature' {
 $sys=Get-CimInstance Win32_ComputerSystem
 if($sys.HypervisorPresent){Add 'hyperv' 'runtime' 'Hyper-V' '已检测到虚拟机监控程序' 'optional' '监控程序运行不等于 Hyper-V 管理工具或 Guest 已准备；在运行环境步骤确认。' 'Win32_ComputerSystem'}
 else {
  $feature=Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All
  Add 'hyperv' 'runtime' 'Hyper-V' ([string]$feature.State) 'optional' '可在运行环境步骤中准备；不阻塞当前预检。' 'Get-WindowsOptionalFeature'
 }
}
Probe 'virtualization' 'runtime' 'CPU 虚拟化' 'Win32_Processor' {
 $cpu=Get-CimInstance Win32_Processor | Select-Object -First 1
 Add 'virtualization' 'runtime' 'CPU 虚拟化' "固件：$($cpu.VirtualizationFirmwareEnabled) · SLAT：$($cpu.SecondLevelAddressTranslationExtensions)" 'optional' 'Hypervisor 已启用时部分固件能力可能不可直接观测；Virtual 准备阶段复验。' 'Win32_Processor'
}
Probe 'memory' 'runtime' '可用内存' 'Win32_OperatingSystem' {
 $os=Get-CimInstance Win32_OperatingSystem
 Add 'memory' 'runtime' '可用内存' "$([math]::Round($os.FreePhysicalMemory/1MB,1)) GB" 'optional' "总内存 $([math]::Round($os.TotalVisibleMemorySize/1MB,1)) GB；Virtual 资源分配后续确认。" 'Win32_OperatingSystem'
}
Probe 'configuration' 'apps' 'Claude 配置线索' 'settings.json / environment variable names' {
 $base=if($env:CLAUDE_CONFIG_DIR){$env:CLAUDE_CONFIG_DIR}else{Join-Path $env:USERPROFILE '.claude'}
 $exists=Test-Path -LiteralPath (Join-Path $base 'settings.json')
 $names=@('ANTHROPIC_BASE_URL','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_API_KEY','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY')
 $present=@($names|Where-Object { [Environment]::GetEnvironmentVariable($_,'Process') -or [Environment]::GetEnvironmentVariable($_,'User') -or [Environment]::GetEnvironmentVariable($_,'Machine') })
 Add 'configuration' 'apps' 'Claude 配置线索' $(if($exists -or $present.Count){'发现配置线索'}else{'未发现已知线索'}) 'unknown' "settings.json 存在：$exists；相关环境变量 $($present.Count) 项（不保存或展示值）。详细归属扫描在第三步。" '文件存在性 / 环境变量存在性'
}
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
ConvertTo-Json -InputObject @($checks.ToArray()) -Depth 6 -Compress

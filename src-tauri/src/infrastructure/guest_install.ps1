# 由计划任务在当前用户的提权上下文中执行。
function Write-GuestProgress([int]$Index, [string]$Detail, [string]$Status = 'running') {
    $now = [DateTime]::UtcNow.ToString('o')
    if (!$script:startedAt) { $script:startedAt = $now }
    if ($script:activeIndex -ne $Index -or !$script:stepStartedAt) { $script:stepStartedAt = $now }
    $script:activeIndex = $Index
    if ($script:lastDetail -ne $Detail) {
        $script:history = @(@($script:history) + @{time=$now; detail=$Detail} | Select-Object -Last 12)
        $script:lastDetail = $Detail
    }
    $script:vm = Get-VM -Id $record.vmId
    $script:tasks[$Index] = @{ status=$Status; detail=$Detail }
    $done = @($script:tasks | Where-Object status -eq 'satisfied').Count
    $data = @{ name=$record.name; nodeName=$record.node.name; nodeId=$record.node.id; exitIp=$record.node.exitIp; state=$script:vm.State.ToString(); ready=($done -eq 8); desktopSetupVersion=3; timezonePolicyVersion=1; timezoneTarget=$record.timezoneTarget; progress=[int]($done * 100 / 8); detail=$Detail; tasks=$script:tasks; error=$script:failure; timezone="$script:tz"; language="$script:language"; updatedAt=[DateTime]::UtcNow.ToString('o') }
    $data.startedAt = $script:startedAt
    $data.stepStartedAt = $script:stepStartedAt
    $data.activeIndex = $Index
    $data.history = @($script:history)
    $file = Join-Path $root 'guest-progress.json'
    $data | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath "$file.tmp" -Encoding UTF8
    Move-Item -LiteralPath "$file.tmp" -Destination $file -Force
}
function Test-GuestDesktop($Session) {
    Invoke-Command -Session $Session -ScriptBlock {
        $setup = Get-ItemProperty HKLM:\SYSTEM\Setup
        if ($setup.SystemSetupInProgress -ne 0 -or $setup.OOBEInProgress -ne 0) { return $false }
        if (Get-Process -Name 'msoobe','CloudExperienceHost','oobenetworkconnectionflow' -ErrorAction SilentlyContinue) { return $false }
        foreach ($shell in @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'")) {
            $owner = Invoke-CimMethod -InputObject $shell -MethodName GetOwner
            if ($owner.ReturnValue -eq 0 -and $owner.User -eq 'CodeSeam') { return $true }
        }
        return $false
    }
}
function Test-GuestSetupRecovery($Session) {
    Invoke-Command -Session $Session -ScriptBlock {
        if (Get-Process -Name 'msoobe','CloudExperienceHost','oobenetworkconnectionflow' -ErrorAction SilentlyContinue) { return $true }
        foreach ($shell in @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'")) {
            $owner = Invoke-CimMethod -InputObject $shell -MethodName GetOwner
            if ($owner.ReturnValue -eq 0 -and $owner.User -eq 'defaultuser0') { return $true }
        }
        return $false
    }
}
# 保持控制台免密码访问，同时不放宽空密码账户的网络策略。
# PowerShell Direct 使用独立账户，其随机凭据通过 DPAPI 保护。
function Set-GuestDesktopAccount($Session) {
    # 远程 ADSI 方法可能输出显式 Null，不能混入安装函数返回的 PSSession。
    Invoke-Command -Session $Session -ErrorAction Stop -ScriptBlock {
        $ErrorActionPreference = 'Stop'
        $user = [ADSI]'WinNT://./CodeSeam,user'
        $user.UserFlags = ([int]$user.UserFlags.Value -bor 0x20)
        $user.SetInfo()
        $user.SetPassword('')
        Set-LocalUser -Name CodeSeam -PasswordNeverExpires $true -ErrorAction Stop
        Set-LocalUser -Name CodeSeamAgent -PasswordNeverExpires $true -ErrorAction Stop
        $hidden = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList'
        New-Item -Path $hidden -Force | Out-Null
        New-ItemProperty -Path $hidden -Name CodeSeamAgent -PropertyType DWord -Value 0 -Force | Out-Null
        $winlogon = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
        foreach ($entry in @{AutoAdminLogon='1'; DefaultUserName='CodeSeam'; DefaultDomainName=$env:COMPUTERNAME; DefaultPassword=''}.GetEnumerator()) {
            New-ItemProperty -Path $winlogon -Name $entry.Key -PropertyType String -Value $entry.Value -Force | Out-Null
        }
        Remove-ItemProperty -Path $winlogon -Name AutoLogonCount -ErrorAction SilentlyContinue
    } | Out-Null
}
function Install-GuestWindows {
    $credentialFile = Join-Path $root 'guest-credential.xml'
    $diskPath = Join-Path $root ($record.name + '\automated-system.vhdx')
    if (!(Test-Path -LiteralPath $credentialFile)) {
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $password = [Convert]::ToBase64String($bytes) + 'aA1!'
        $credential = [pscredential]::new('CodeSeamAgent', (ConvertTo-SecureString $password -AsPlainText -Force))
        $credential | Export-Clixml -LiteralPath $credentialFile
    } else {
        $credential = Import-Clixml -LiteralPath $credentialFile
        $password = $credential.GetNetworkCredential().Password
    }
    if ($credential.UserName -ne 'CodeSeamAgent') {
        throw '此 Guest 使用旧版账户配置，请重新创建候选环境后初始化。'
    }
    if (!$record.deployed) {
        Write-GuestProgress 0 '正在自动部署 Windows 系统镜像'
        # 保留现有候选虚拟机的原磁盘，不格式化或覆盖。
        if ($vm.State -ne 'Off') {
            # 保留旧版安装程序候选虚拟机及其内存状态，不强制停止。
            $previousId = $vm.Id.ToString()
            if ($vm.State -ne 'Saved') { Save-VM -VM $vm -Confirm:$false }
            $previousName = $record.name + '-preserved-' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
            Rename-VM -VM $vm -NewName $previousName
            $script:vm = New-VM -Name $record.name -Generation 2 -MemoryStartupBytes ([long]$record.config.memory * 1GB) -NoVHD -Path (Join-Path $root 'Unattended') -SwitchName $record.config.network
            Set-VMProcessor -VM $script:vm -Count $record.config.cpu
            Set-VMFirmware -VM $script:vm -EnableSecureBoot On
            $record.vmId = $script:vm.Id.ToString()
            $record | Add-Member -NotePropertyName preservedVmId -NotePropertyValue $previousId -Force
            Save-Checkpoint $record
            $vm = $script:vm
        }
        $vm = Get-VM -Id $record.vmId
        if ($vm.State -ne 'Off') { throw '等待候选虚拟机正常关闭，未强制停止或覆盖原系统盘' }
        if (Test-Path -LiteralPath $diskPath) { throw '检测到中断的系统部署磁盘，已保留以便诊断，未覆盖' }
        $media = $null; $mountedDisk = $null
        try {
            $media = Mount-DiskImage -ImagePath $record.config.iso -PassThru
            $volume = $media | Get-Volume
            $sourceRoot = "$($volume.DriveLetter):\"
            $imageFile = Join-Path $sourceRoot 'sources\install.wim'
            if (!(Test-Path -LiteralPath $imageFile)) { $imageFile = Join-Path $sourceRoot 'sources\install.esd' }
            if (!(Test-Path -LiteralPath $imageFile)) { throw '安装介质中没有 install.wim 或 install.esd' }
            $images = @(Get-WindowsImage -ImagePath $imageFile)
            if ($images.Count -ne 1) { throw '镜像包含多个系统版本，尚未明确选择版本，已停止部署' }
            $image = Get-WindowsImage -ImagePath $imageFile -Index $images[0].ImageIndex
            if ($image.Architecture -ne 9 -or ([version]$image.Version).Major -ne 10 -or ([version]$image.Version).Build -ge 22000) { throw '仅支持 Windows 10 x64 系统镜像' }
            New-VHD -Path $diskPath -Dynamic -SizeBytes ([long]$record.config.disk * 1GB) | Out-Null
            $mountedDisk = Mount-VHD -Path $diskPath -PassThru | Get-Disk
            # 磁盘编号只取自新建的 VHD，不搜索宿主机磁盘。
            $mountedDisk | Initialize-Disk -PartitionStyle GPT | Out-Null
            $efi = New-Partition -DiskNumber $mountedDisk.Number -Size 260MB -GptType '{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}' -AssignDriveLetter
            $efi | Format-Volume -FileSystem FAT32 -Confirm:$false | Out-Null
            New-Partition -DiskNumber $mountedDisk.Number -Size 16MB -GptType '{e3c9e316-0b5c-4db8-817d-f92df00215ae}' | Out-Null
            $os = New-Partition -DiskNumber $mountedDisk.Number -UseMaximumSize -AssignDriveLetter
            $os | Format-Volume -FileSystem NTFS -Confirm:$false | Out-Null
            $osRoot = "$($os.DriveLetter):\"
            Expand-WindowsImage -ImagePath $imageFile -Index $image.ImageIndex -ApplyPath $osRoot -CheckIntegrity | Out-Null
            & bcdboot.exe (Join-Path $osRoot 'Windows') /s "$($efi.DriveLetter):" /f UEFI | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Windows 启动文件部署失败：$LASTEXITCODE" }
            $encodedPassword = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($password + 'Password'))
            $answer = @"
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
 <settings pass="specialize"><component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS"><ComputerName>CodeSeam-Guest</ComputerName></component></settings>
 <settings pass="oobeSystem">
 <component name="Microsoft-Windows-International-Core" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS"><InputLocale>en-US</InputLocale><SystemLocale>en-US</SystemLocale><UILanguage>en-US</UILanguage><UserLocale>en-US</UserLocale></component>
 <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
  <OOBE><HideEULAPage>true</HideEULAPage><HideOnlineAccountScreens>true</HideOnlineAccountScreens><HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE><ProtectYourPC>3</ProtectYourPC></OOBE>
  <UserAccounts><LocalAccounts>
   <LocalAccount xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" wcm:action="add"><Name>CodeSeam</Name><Group>Administrators</Group><Password><Value></Value><PlainText>true</PlainText></Password></LocalAccount>
   <LocalAccount xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" wcm:action="add"><Name>CodeSeamAgent</Name><Group>Administrators</Group><Password><Value>$encodedPassword</Value><PlainText>false</PlainText></Password></LocalAccount>
  </LocalAccounts></UserAccounts>
  <AutoLogon><Password><Value></Value><PlainText>true</PlainText></Password><Enabled>true</Enabled><LogonCount>999999</LogonCount><Username>CodeSeam</Username></AutoLogon>
 </component></settings>
</unattend>
"@
            $panther = Join-Path $osRoot 'Windows\Panther'
            New-Item -ItemType Directory -Path $panther -Force | Out-Null
            $answer | Set-Content -LiteralPath (Join-Path $panther 'unattend.xml') -Encoding UTF8
        } finally {
            if ($mountedDisk) { Dismount-VHD -Path $diskPath }
            if ($media) { Dismount-DiskImage -ImagePath $record.config.iso | Out-Null }
        }
        $originalDisks = @(Get-VMHardDiskDrive -VM $vm)
        foreach ($disk in $originalDisks) { Remove-VMHardDiskDrive -VMHardDiskDrive $disk }
        Add-VMHardDiskDrive -VM $vm -Path $diskPath
        $boot = Get-VMHardDiskDrive -VM $vm | Where-Object Path -eq $diskPath
        Set-VMFirmware -VM $vm -FirstBootDevice $boot
        $record | Add-Member -NotePropertyName deployed -NotePropertyValue $true -Force
        $record | Add-Member -NotePropertyName preservedDisks -NotePropertyValue @($originalDisks.Path) -Force
        Save-Checkpoint $record
    }
    if ((Get-VM -Id $record.vmId).State -eq 'Off') { Start-VM -VM $vm | Out-Null }
    Write-GuestProgress 0 '正在无人值守完成首次启动并连接 Guest'
    $repairAttempted = $false
    $deadline = [DateTime]::UtcNow.AddMinutes(20)
    do {
        Write-GuestProgress 0 '正在连接 Guest…'
        try { $session = New-PSSession -VMId $record.vmId -Credential $credential -ErrorAction Stop } catch {
            $session = $null
            Write-GuestProgress 0 '正在等待 Windows 启动…'
        }
        if ($session) {
            Set-GuestDesktopAccount $session
            $setupComplete = Test-GuestDesktop $session
            if (!$setupComplete) {
                $reason = Invoke-Command -Session $session -ScriptBlock {
                    $setup = Get-ItemProperty HKLM:\SYSTEM\Setup
                    if ($setup.SystemSetupInProgress -ne 0) { return 'Guest 已连接，Windows 系统安装仍在进行' }
                    if ($setup.OOBEInProgress -ne 0 -or (Get-Process -Name 'msoobe','CloudExperienceHost','oobenetworkconnectionflow' -ErrorAction SilentlyContinue)) { return 'Guest 已连接，Windows 首次设置尚未完成（地区、键盘或账户设置）' }
                    return 'Guest 已连接，正在等待 CodeSeam 用户登录并启动桌面；尚未检测到该用户的 explorer.exe'
                } -ErrorAction Stop
                Write-GuestProgress 0 $reason
            }
            if (!$setupComplete -and !$repairAttempted) {
                $oobeActive = Test-GuestSetupRecovery $session
                if ($oobeActive) {
                    $repairAttempted = $true
                    Write-GuestProgress 0 '正在补齐已有 Guest 的首次设置，重启后等待桌面就绪'
                    Invoke-Command -Session $session -ScriptBlock {
                        $answer = @"
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend"><settings pass="oobeSystem">
<component name="Microsoft-Windows-International-Core" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS"><InputLocale>en-US</InputLocale><SystemLocale>en-US</SystemLocale><UILanguage>en-US</UILanguage><UserLocale>en-US</UserLocale></component>
<component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS"><OOBE><HideEULAPage>true</HideEULAPage><HideOnlineAccountScreens>true</HideOnlineAccountScreens><HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE><ProtectYourPC>3</ProtectYourPC></OOBE><AutoLogon><Password><Value></Value><PlainText>true</PlainText></Password><Enabled>true</Enabled><LogonCount>999999</LogonCount><Username>CodeSeam</Username></AutoLogon></component>
</settings></unattend>
"@
                        $path = 'C:\Windows\Panther\codeseam-desktop-unattend.xml'
                        [IO.File]::WriteAllText($path, $answer, [Text.UTF8Encoding]::new($false))
                        # 补齐缺失答案后重新运行 OOBE，同时保留已安装的磁盘和账户。
                        Start-Process -FilePath "$env:SystemRoot\System32\Sysprep\sysprep.exe" -ArgumentList @('/oobe','/reboot','/quiet',('/unattend:' + $path)) -WindowStyle Hidden -ErrorAction Stop | Out-Null
                    } | Out-Null
                }
            }
            if (!$setupComplete) { Remove-PSSession $session; $session = $null }
        }
        if (!$session) { Start-Sleep -Seconds 5 }
    } while (!$session -and [DateTime]::UtcNow -lt $deadline)
    if (!$session) { throw "Windows 首次启动等待超过 20 分钟。最后状态：$script:lastDetail。请查看虚拟机界面；诊断日志位于 $root\guest-error.log，部署磁盘已保留。" }
    return $session
}
function Sync-GuestTimezone($Session, $Target) {
    if (!$Target.windowsId -or !$Target.ianaId) { throw '所选出口的目标时区尚未确定，请重新测试节点。' }
    $result = Invoke-Command -Session $Session -ArgumentList $Target.windowsId -ScriptBlock {
        param($expected)
        $ErrorActionPreference = 'Stop'
        Get-TimeZone -Id $expected -ErrorAction Stop | Out-Null
        if ((Get-TimeZone).Id -ne $expected) { Set-TimeZone -Id $expected -ErrorAction Stop }
        [TimeZoneInfo]::ClearCachedData()
        $actual = (Get-TimeZone).Id
        if ($actual -ne $expected) { throw ('Guest 时区应用失败：' + $actual + '，目标为 ' + $expected) }
        return $actual
    }
    # Strip remoting metadata before persisting or serializing this string.
    return [string]$result
}
function Initialize-Guest {
    $script:startedAt = [DateTime]::UtcNow.ToString('o')
    $script:stepStartedAt = $null
    $script:activeIndex = -1
    $script:history = @()
    $script:lastDetail = $null
    $script:tasks = @(0..7 | ForEach-Object { @{ status='pending'; detail='等待前序任务完成' } })
    $script:failure = $null
    $script:vm = Get-VM -Id $record.vmId
    $index = 0; $session = $null
    try {
        $session = Install-GuestWindows
        if (!$session) { throw 'Guest 会话未建立，请重试初始化；已部署的 Windows 将继续使用。' }
        Write-GuestProgress 0 'Windows 首次设置已完成，CodeSeam 桌面已就绪' 'satisfied'
        $index = 1
        Write-GuestProgress 1 '正在按所选代理出口设置 Guest 时区'
        $script:tz = Sync-GuestTimezone $session $record.timezoneTarget
        Write-GuestProgress 1 "Guest 时区：$tz（与所选出口一致）" 'satisfied'
        $index = 2
        $script:language = Invoke-Command -Session $session -ScriptBlock { (Get-UICulture).Name }
        Write-GuestProgress 2 "Guest 显示语言：$language（保留镜像设置）" 'satisfied'
        Invoke-Command -Session $session -ScriptBlock {
            Get-ChildItem C:\Windows\Panther -Filter '*unattend*.xml' -Recurse -ErrorAction SilentlyContinue | Remove-Item -Force
        }
        $index = 3
        Write-GuestProgress 3 '正在验证 Guest 时间同步'
        Invoke-Command -Session $session -ScriptBlock {
            Set-Service W32Time -StartupType Automatic
            Start-Service W32Time
            & w32tm.exe /resync /rediscover | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Guest 时间同步失败' }
            & w32tm.exe /query /status | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Guest 时间同步状态读取失败' }
            # 删除包含生成的本地账户密码的缓存应答文件。
            Get-ChildItem C:\Windows\Panther -Filter '*unattend*.xml' -Recurse -ErrorAction SilentlyContinue | Remove-Item -Force
        }
        Write-GuestProgress 3 'Guest 时间服务已运行，重新同步及状态查询成功' 'satisfied'
        $index = 4
        Write-GuestProgress 4 '正在安装 Guest 受管代理'
        Add-Type -AssemblyName System.Security
        $encrypted = [IO.File]::ReadAllBytes((Join-Path (Split-Path $root) 'virtual-node-v1.dpapi'))
        $nodeConfig = [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($encrypted,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)) | ConvertFrom-Json
        $guestDir = 'C:\ProgramData\CodeSeam\Network'
        Invoke-Command -Session $session -ScriptBlock {
            param($dir)
            Stop-ScheduledTask -TaskName 'CodeSeam-Network' -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            & icacls.exe $dir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Guest 代理凭据目录权限设置失败' }
        } -ArgumentList $guestDir
        Copy-Item -LiteralPath (Join-Path (Split-Path $root) 'mihomo\mihomo-v1.19.34.exe') -Destination "$guestDir\mihomo.exe" -ToSession $session
        $provider = if ($nodeConfig.uri) { $nodeConfig.uri } else { @{proxies=@($nodeConfig)} | ConvertTo-Json -Depth 30 -Compress }
        $proxyConfig = @{
            'mode'='rule'; 'log-level'='warning'; 'ipv6'=$false
            'proxy-providers'=@{ selected=@{type='file'; path='selected.yaml'} }
            'proxy-groups'=@(@{name='selected'; type='select'; use=@('selected')})
            'rules'=@('NETWORK,udp,REJECT','MATCH,selected')
            'tun'=@{enable=$true; stack='mixed'; 'auto-route'=$true; 'strict-route'=$true; 'auto-detect-interface'=$true; 'dns-hijack'=@('any:53','tcp://any:53'); device='CodeSeam-TUN'}
            'dns'=@{enable=$true; listen='127.0.0.1:53'; 'enhanced-mode'='redir-host'; 'nameserver'=@('https://1.1.1.1/dns-query#selected','https://8.8.8.8/dns-query#selected'); 'proxy-server-nameserver'=@('https://223.5.5.5/dns-query','https://1.1.1.1/dns-query')}
        } | ConvertTo-Json -Depth 20
        Invoke-Command -Session $session -ScriptBlock {
            param($dir,$provider,$config)
            [IO.File]::WriteAllText("$dir\selected.yaml",$provider,[Text.UTF8Encoding]::new($false))
            [IO.File]::WriteAllText("$dir\config.json",$config,[Text.UTF8Encoding]::new($false))
            & "$dir\mihomo.exe" -t -d $dir -f "$dir\config.json" 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Guest 代理配置验证失败' }
            $runner = '& "' + $dir + '\mihomo.exe" -d "' + $dir + '" -f "' + $dir + '\config.json" *> "' + $dir + '\network.log"'
            [IO.File]::WriteAllText("$dir\runner.ps1",$runner,[Text.UTF8Encoding]::new($true))
            $a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $dir + '\runner.ps1"')
            Register-ScheduledTask -TaskName 'CodeSeam-Network' -Action $a -Trigger (New-ScheduledTaskTrigger -AtStartup) -User SYSTEM -RunLevel Highest -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew) -Force | Out-Null
            Start-ScheduledTask -TaskName 'CodeSeam-Network'
            Start-Sleep -Seconds 5
            if ((Get-ScheduledTask -TaskName 'CodeSeam-Network').State -ne 'Running') { throw 'Guest 代理未保持运行' }
            Get-NetAdapterBinding -ComponentID ms_tcpip6 | Where-Object Enabled | Disable-NetAdapterBinding | Out-Null
            Get-NetAdapter | Where-Object Status -eq Up | ForEach-Object { Set-DnsClientServerAddress -InterfaceIndex $_.ifIndex -ServerAddresses '198.18.0.2' }
        } -ArgumentList $guestDir,$provider,$proxyConfig
        Write-GuestProgress 4 'Guest 受管代理已启动，使用第二步选定节点' 'satisfied'
        $index = 5
        Write-GuestProgress 5 '正在 Guest 内验证 DNS'
        Invoke-Command -Session $session -ScriptBlock {
            foreach ($tcp in @($false, $true)) {
                $lastError = $null
                for ($attempt = 0; $attempt -lt 3; $attempt++) {
                    try {
                        $answers = @(Resolve-DnsName www.microsoft.com -Type A -DnsOnly -NoHostsFile -TcpOnly:$tcp -ErrorAction Stop)
                        if (!$answers.Count) { throw 'Guest DNS 未返回结果' }
                        $lastError = $null
                        break
                    } catch {
                        $lastError = $_
                        if ($attempt -lt 2) { Start-Sleep -Seconds 2 }
                    }
                }
                if ($lastError) { throw $lastError }
            }
            $dns = @(Get-NetAdapter | Where-Object Status -eq Up | Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses.Count -gt 0 })
            if (@($dns | Where-Object { $_.ServerAddresses | Where-Object { $_ -ne '198.18.0.2' } }).Count) { throw 'Guest 存在非受管 DNS' }
        }
        Write-GuestProgress 5 'Guest DNS 经受管隧道解析成功，加密 DNS 经已选节点，UDP / TCP 查询均通过' 'satisfied'
        $index = 6
        Write-GuestProgress 6 '正在 Guest 内验证实际出口及 IPv6 / UDP 策略'
        $observed = Invoke-Command -Session $session -ScriptBlock {
            if (@(Get-NetAdapterBinding -ComponentID ms_tcpip6 | Where-Object Enabled).Count) { throw 'Guest IPv6 仍启用' }
            # 阻止外部 UDP 流量，同时保留受管理 TUN 接口内的 DNS 流量。
            Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True
            $externalInterfaces = @((Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.Name -ne 'CodeSeam-TUN' }).Name)
            if (!$externalInterfaces.Count) { throw '未找到 Guest 外部网络接口' }
            if (!(Get-NetFirewallRule -Name 'CodeSeam-Block-UDP' -ErrorAction SilentlyContinue)) {
                New-NetFirewallRule -Name 'CodeSeam-Block-UDP' -DisplayName 'CodeSeam managed UDP policy' -Direction Outbound -Action Block -Protocol UDP -RemotePort @('1-66','69-65535') -InterfaceAlias $externalInterfaces | Out-Null
            }
            Set-NetFirewallRule -Name 'CodeSeam-Block-UDP' -InterfaceAlias $externalInterfaces
            if ((Get-NetFirewallRule -PolicyStore ActiveStore -Name 'CodeSeam-Block-UDP').Enabled -ne 'True' -or @(Get-NetFirewallProfile | Where-Object { !$_.Enabled }).Count) { throw 'Guest UDP 阻断规则未启用' }
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $ip = $null
            foreach ($endpoint in @('https://www.cloudflare.com/cdn-cgi/trace','https://speed.cloudflare.com/cdn-cgi/trace')) {
                try {
                    $trace = (Invoke-WebRequest -Uri $endpoint -UseBasicParsing -TimeoutSec 20).Content
                    $line = @($trace -split "`n" | Where-Object { $_.StartsWith('ip=') })
                    if ($line.Count -ne 1) { throw 'Guest 出口检测响应缺少唯一 IP' }
                    $ip = $line[0].Substring(3).Trim()
                    [Net.IPAddress]::Parse($ip) | Out-Null
                    break
                } catch {
                    if ($endpoint -eq 'https://speed.cloudflare.com/cdn-cgi/trace') { throw }
                }
            }
            [Net.IPAddress]::Parse($ip) | Out-Null
            return $ip
        }
        if ($observed -ne $record.node.exitIp) { throw "Guest 实测出口 $observed 与第二步已选出口不一致" }
        Write-GuestProgress 6 "Guest 实测出口：$observed；IPv6 已关闭，UDP 已阻断" 'satisfied'
        $index = 7
        Write-GuestProgress 7 '正在保存候选环境基线'
        $script:tz = Sync-GuestTimezone $session $record.timezoneTarget
        $baseline = @{vmId=$record.vmId; nodeId=$record.node.id; exitIp="$observed"; timezone="$tz"; timezoneTarget=$record.timezoneTarget; language="$language"; measuredAt=[DateTime]::UtcNow.ToString('o'); tasks=$script:tasks}
        Checkpoint-VM -VM $vm -SnapshotName 'CodeSeam-Initialized' | Out-Null
        $script:tasks[7] = @{status='satisfied';detail='候选基线与恢复检查点已生成'}
        $baseline.tasks = $script:tasks
        $baselinePath = Join-Path $root 'candidate-baseline.json'
        $baseline | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath "$baselinePath.tmp" -Encoding UTF8
        Move-Item -LiteralPath "$baselinePath.tmp" -Destination $baselinePath -Force
        Write-GuestProgress 7 '候选基线与恢复检查点已生成，等待后续确认' 'satisfied'
    } catch {
        $_ | Out-String | Set-Content -LiteralPath (Join-Path $root 'guest-error.log') -Encoding UTF8
        $_.ScriptStackTrace | Add-Content -LiteralPath (Join-Path $root 'guest-error.log') -Encoding UTF8
        $script:failure = $_.Exception.Message
        Write-GuestProgress $index $script:failure 'failed'
        throw
    } finally {
        if ($session) { Remove-PSSession $session }
    }
}

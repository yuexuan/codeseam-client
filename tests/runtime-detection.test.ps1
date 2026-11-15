# 使用内存中的操作系统状态验证正式检测器，不会修改系统设置。
$ErrorActionPreference='Stop'
$detector=Get-Content -LiteralPath (Join-Path $PSScriptRoot '../src-tauri/src/infrastructure/runtime.ps1') -Raw -Encoding UTF8
$script:zone='Singapore Standard Time'; $script:sync=$true; $script:v6=$false; $script:trusted=$true; $script:resolves=$true; $script:nrpt=$false
function Get-TimeZone { [pscustomobject]@{Id=$script:zone} }
function Get-UICulture { [pscustomobject]@{NativeName='English';Name='en-US';TwoLetterISOLanguageName='en'} }
function Get-Culture { [pscustomobject]@{NativeName='English';Name='en-US'} }
function Get-CimInstance { [pscustomobject]@{State=$(if($script:sync){'Running'}else{'Stopped'});StartMode='Auto'} }
function Get-NetAdapter { [pscustomobject]@{Status='Up';Name='fixture';ifIndex=1} }
function Get-NetAdapterBinding { [pscustomobject]@{Enabled=$script:v6;Name='fixture'} }
function Get-DnsClientServerAddress { [pscustomobject]@{InterfaceAlias='fixture';AddressFamily=2;ServerAddresses=@($(if($script:trusted){'1.1.1.2'}else{'10.0.0.1'}))} }
function Get-DnsClientNrptPolicy { if($script:nrpt){[pscustomobject]@{Namespace='.example'}} }
function Resolve-DnsName { if(!$script:resolves){throw 'fixture lookup failed'}; [pscustomobject]@{Type=1;Section='Answer';IPAddress='192.0.2.1'} }
function Read-Checks {
 $TargetTimezone='Singapore Standard Time'
 $raw = & ([scriptblock]::Create($detector))
 $parsed=$raw | ConvertFrom-Json
 foreach($entry in $parsed){$entry}
}
function Assert-State($id,$expected) {
 $check=@(Read-Checks | Where-Object id -eq $id)[0]
 if($check.status -ne $expected){throw "$id expected $expected got $($check.status)"}
 if($expected -ne 'satisfied' -and !$check.blocking){throw "$id must block continuation"}
}
foreach($id in @('timezone','language','time_sync','dns','ipv6')){Assert-State $id 'satisfied'}
$script:zone='Pacific Standard Time'; Assert-State timezone pending; $script:zone='Singapore Standard Time'
$script:sync=$false; Assert-State time_sync pending; $script:sync=$true
$script:v6=$true; Assert-State ipv6 pending; $script:v6=$false
$script:trusted=$false; Assert-State dns pending; $script:trusted=$true
$script:resolves=$false; Assert-State dns unknown; $script:resolves=$true
$script:nrpt=$true; Assert-State dns pending; $script:nrpt=$false
foreach($id in @('timezone','language','time_sync','dns','ipv6')){Assert-State $id 'satisfied'}
Write-Output 'PASS: match, mismatch, stopped time service, enabled IPv6, untrusted DNS, DNS failure, NRPT and recovery'

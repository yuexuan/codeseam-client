import type { DiagnosticsTab } from "./types";
export const TABS: { id: DiagnosticsTab; label: string }[] = [
  {id:"system",label:"系统环境"},{id:"network",label:"代理与网络"},{id:"browser",label:"浏览器与指纹"},{id:"claude",label:"Claude Code"},{id:"recovery",label:"高级与恢复"},
];
export const GROUPS: Record<DiagnosticsTab,string[]> = {
  system:["timezone","system_proxy","tun","local_ipv6","system_dns"],
  network:["local_sg_node","clash","clash_nodes","clash_policy","sg_profile","egress_ipv4","dns","egress_ipv6","udp","kill_switch","server_egress","non_api"],
  browser:["browser_egress","browser_dns","browser_ipv6","browser_webrtc","browser_fingerprint"],
  claude:["proxy","config"],recovery:["config_recovery"],
};
export const TITLES: Record<string,string> = {
  timezone:"系统时区",system_proxy:"系统代理",tun:"TUN 网卡",local_ipv6:"IPv6",system_dns:"系统 DNS",local_sg_node:"本地代理节点",
  clash:"代理连接",clash_nodes:"节点与策略",clash_policy:"目标路由",sg_profile:"运行地区",egress_ipv4:"API 网络出口",dns:"API DNS 路径",egress_ipv6:"API IPv6 路径",udp:"UDP 路径",kill_switch:"断线保护",server_egress:"服务端出口",non_api:"非 API 流量",
  proxy:"受管代理",config:"API 配置",config_recovery:"配置备份",browser_egress:"网络出口",browser_dns:"DNS",browser_ipv6:"IPv6",browser_webrtc:"WebRTC",browser_fingerprint:"浏览器指纹",browser_region:"出口地区",
};
export const SCAN_ORDER = TABS.flatMap(t=>GROUPS[t.id]);
export const STATUS_TEXT: Record<string,string> = {pass:"通过",fail:"未通过",warning:"需配置",unknown:"需配置",not_checked:"未检测",waiting:"等待检测",running:"检测中",skipped:"未启用",not_applicable:"不适用",unsupported:"暂不支持",not_created:"未创建",reboot_required:"需重启",interrupted:"检测中断"};

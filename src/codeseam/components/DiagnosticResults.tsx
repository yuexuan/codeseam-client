import { useState } from "react";
import { CheckCircle2, ChevronDown, CircleAlert, Clock3, LoaderCircle, Minus, XCircle } from "lucide-react";
import type { CheckItem } from "../lib/types";
import { STATUS_TEXT,TITLES } from "../lib/diagnostics";
import { fullTime } from "../lib/format";
import { HelpTip } from "./ui/HelpTip";
import { Button } from "./ui/Button";
export function CheckStatus({status}:{status:string}) {
  const Icon=status==="pass"?CheckCircle2:status==="running"?LoaderCircle:status==="fail"?XCircle:status==="waiting"?Clock3:["unknown","warning","reboot_required","interrupted"].includes(status)?CircleAlert:Minus;
  return <span className={`check-status check-status--${status}`}><Icon size={16} className={status==="running"?"check-spin":""}/>{STATUS_TEXT[status]??status}</span>;
}
const HELP:Record<string,string>={
  timezone:"按目标时区核对系统时间偏移。浏览器使用独立时区，出口地区另外检测。",
  system_proxy:"检查系统代理是否启用。具体请求是否走代理，由网络出口实测判断。",
  tun:"检查 TUN 网卡连接状态；具体请求路径请查看代理与网络。",
  local_ipv6:"通过条件：全部网卡 IPv6 绑定关闭、全局关闭生效，且没有外部 IPv6 地址和默认路由。Windows 要求重启时会显示需重启。",
  system_dns:"通过条件：DNS 无直连泄漏。仅更换公共 DNS 地址或解析成功不满足该条件。请在下方选择 DNS 配置；详细观测可展开查看。",
  browser_dns:"DNS 无直连泄漏才通过。需要真实查询路径证据；代理地址填写正确不等于已通过。",
  browser_fingerprint:"每次打开都会与首次保存的真实指纹基准比较；浏览器升级或硬件变更导致差异时不会自动覆盖基准。销毁环境后才能建立新基准。",
};
export function shortResult(item:CheckItem) {
  if(["waiting","running","not_created","not_checked"].includes(item.status)) return item.status==="running"?"正在检查…":"—";
  if(item.status==="reboot_required") return "关闭配置已保存，请重启电脑";
  if(item.id==="system_proxy"){
    const address=item.detail.match(/地址=(?:"([^"]+)"|([^；;]+))/);
    if(address)return address[1]??address[2];
  }
  if(item.id==="browser_dns"&&item.status==="pass")return "未发现直连泄漏";
  if(item.id==="browser_webrtc"&&item.status==="pass")return "未发现直连地址";
  if(item.id==="local_ipv6"&&item.status==="pass")return "已关闭";
  if(item.id==="browser_fingerprint"&&item.status==="pass")return "与保存的基准一致";
  if(item.id==="system_dns"&&item.status!=="pass")return "尚未验证无直连泄漏";
  if(item.id==="timezone"&&item.status==="pass")return "UTC+8 · 与目标一致";
  return item.detail.split(/[；;\n]/)[0].replace(/^"|"$/g,"");
}
export function ResultRow({item,time,onConfig}:{item:CheckItem;time?:number;onConfig?:()=>void}) {
  const [open,setOpen]=useState(false); const label=TITLES[item.id]??item.label;
  let evidence:unknown;try{evidence=JSON.parse(item.evidence??"null");}catch{evidence=item.evidence;}
  const fp=item.id==="browser_fingerprint"&&evidence&&typeof evidence==="object"?(evidence as {observed?:Record<string,unknown>}).observed:undefined;
  const e=(evidence&&typeof evidence==="object"?evidence:{}) as Record<string,any>;
  const facts:[string,string][]=[];
  if(item.id==="system_dns"){
    const resolvers=e.probe?.resolverEgress??e.resolverEgress??[];
    const servers=(e.adapters??[]).filter((a:any)=>a.status==="Up").flatMap((a:any)=>a.dns4??[]);
    facts.push(["递归 DNS",resolvers.join("、")||"未取得"],["DNS 服务器",[...new Set(servers)].join("、")||"未取得"]);
  }
  if(item.id==="local_ipv6")facts.push(["启用绑定",Array.isArray(e.adapters)?String(e.adapters.filter((a:any)=>a.ipv6Enabled&&a.status!=="Not Present").length):"—"],["默认路由",Array.isArray(e.routes)?String(e.routes.length):"—"],["公网 IPv6",e.publicProbe?.ip??"未连接"]);
  if(item.id==="browser_egress"&&e.region){
    let region:any;try{region=JSON.parse(e.region.evidence??"{}");}catch{}
    if(region?.lookup)facts.push(["出口地区",[region.lookup.countryCode,region.lookup.timezone].filter(Boolean).join(" · ")||"未取得"]);
    facts.push(["地区对照",e.region.status==="pass"?"与环境一致":e.region.status==="warning"?"与环境不一致":"未取得完整结果"]);
  }

  return <div className={`env-result ${open?"env-result--open":""} ${item.status==="running"?"env-result--running":""}`}>
    <div className="env-result-main"><div className="env-result-title"><strong>{label}</strong><HelpTip label={label}>{HELP[item.id]??"展开查看本次检测详情；需配置的项目请在下方修改后重新检测。"}</HelpTip></div>
      <span className="env-observation" title={item.detail}>{shortResult(item)}</span><CheckStatus status={item.status}/>
      <button className="env-expand" aria-label={`${label}详情`} aria-expanded={open} onClick={()=>setOpen(v=>!v)}><ChevronDown size={16} className={open?"is-open":""}/></button></div>
    {open&&<div className={`env-evidence ${fp?"env-evidence--fingerprint":""}`}>{!fp&&!facts.length&&<p>{item.detail}</p>}{!!facts.length&&<dl className="result-facts">{facts.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
      {fp&&<dl className="fingerprint-details">{[["语言",fp.language],["时区",fp.timezone],["分辨率",`${fp.width} × ${fp.height}`],[fp.canvas?"Canvas 基准":"CPU 核心数",fp.canvas??fp.cores]].map(([k,v])=><div key={String(k)}><dt>{String(k)}</dt><dd>{String(v??"—")}</dd></div>)}</dl>}
      {item.remediation&&<p>{item.remediation}</p>}
      {item.evidence&&<details className="raw-evidence"><summary>检测证据</summary><pre>{typeof evidence==="string"?evidence:JSON.stringify(evidence,null,2)}</pre></details>}
      {time&&!fp&&!facts.length&&<small>检测时间：{fullTime(time*1000)}</small>}{onConfig&&item.status!=="pass"&&<Button size="sm" onClick={onConfig}>前往配置</Button>}</div>}
  </div>;
}
export function ResultsHeading(){return <div className="results-columns" aria-hidden="true"><span>检测项目</span><span>简要结果</span><span>状态</span><span/></div>;}

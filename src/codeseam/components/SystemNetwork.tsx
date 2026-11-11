import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CodeSeam } from "../lib/useCodeSeam";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { HelpTip } from "./ui/HelpTip";
import { DecisionDialog } from "./ui/DecisionDialog";
type Adapter = { id:string; index:number; name:string; description:string; status:string; physical:boolean; ipv6Enabled:boolean|null; dnsAvailable:boolean; dns4:string[]; dns6:string[]; static4:string[]; static6:string[] };
type Backup = { exists:boolean; phase?:string; appliedAt?:number; adapterIds?:string[] };
type Inspection = {generatedAt:number;ipv6RebootVerified?:boolean;state:{build:number;administrator:boolean;adapters:Adapter[];ipv6RegistryExists:boolean;ipv6RegistryValue:number|null;ipv6Routes:unknown[];ipv6Addresses:unknown[];dohSupported:boolean;bootTime:number;nrptRules:number};probe:{answers:string[];resolverEgress:string[];error?:string;note:string};ipv6Probe:{ip?:string;error?:string};backups:{ipv6:Backup;dns:Backup}};
type Change = { action:"disable_ipv6"|"set_dns"; adapterIds:string[]; preset:string|null; doh:boolean };
type Plan = {id:string;change:Change;before:Inspection["state"];profile:{name:string;servers:string[];template:string}|null;requiresReboot:boolean};


export function SystemNetwork({cs,onDirty,recoveryOnly=false}:{cs:CodeSeam;onDirty:(dirty:boolean)=>void;recoveryOnly?:boolean}) {
  const [data,setData]=useState<Inspection>();
  const [selected,setSelected]=useState<string[]>([]);
  const [preset,setPreset]=useState("keep");
  const [ipv6,setIpv6]=useState(false);
  const [doh,setDoh]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [plans,setPlans]=useState<Plan[]>();
  const [restore,setRestore]=useState<Change["action"]>();
  const refresh=async()=>{
    const next=await invoke<Inspection>("cs_system_network_inspect",{configurationOnly:true});
    if(!next?.state)throw new Error("请在 Windows 桌面客户端配置系统网络。");
    setData(next);return next;
  };
  useEffect(()=>{let active=true;void refresh().then(v=>{if(active)setSelected(v.state.adapters.filter(a=>a.physical&&a.status==="Up"&&a.dnsAvailable).map(a=>a.id));}).catch(e=>{if(active)setError(String(e));});return()=>{active=false;};},[]);
  useEffect(()=>{if(!recoveryOnly)onDirty(ipv6||preset!=="keep");},[ipv6,preset,onDirty,recoveryOnly]);
  const locked=busy||cs.busy||cs.diagnosticsBusy||!!cs.scan;
  const adapters=data?.state.adapters.filter(a=>a.status!=="Not Present")??[];
  const run=async(action:()=>Promise<void>)=>{setBusy(true);cs.setDiagnosticsBusy(true);setError("");setMessage("");try{await action();}catch(e){setError(String(e));}finally{setBusy(false);cs.setDiagnosticsBusy(false);}};
  const prepare=()=>run(async()=>{
    const changes:Change[]=[];
    if(ipv6)changes.push({action:"disable_ipv6",adapterIds:adapters.filter(a=>a.ipv6Enabled!==null).map(a=>a.id),preset:null,doh:false});
    if(preset!=="keep")changes.push({action:"set_dns",adapterIds:selected,preset,doh:preset!=="proxy"&&doh});
    // 后端只保留一个会过期的计划，因此仅预览第一项；后续变更会基于上一项执行后的实际状态重新规划。
    const first=await invoke<Plan>("cs_system_network_plan",{change:changes[0]});
    setPlans([first,...changes.slice(1).map(change=>({change} as Plan))]);
  });
  const apply=()=>run(async()=>{
    const queue=plans??[];setPlans(undefined);
    try {
      for(let i=0;i<queue.length;i++){
        const plan=i===0?queue[i]:await invoke<Plan>("cs_system_network_plan",{change:queue[i].change});
        await invoke("cs_system_network_apply",{planId:plan.id});
        if(plan.change.action==="disable_ipv6")setIpv6(false);else setPreset("keep");
        cs.log("config",plan.change.action==="disable_ipv6"?"IPv6 关闭配置已应用":"DNS 配置已应用");
      }

    } finally { await refresh();await cs.scanDiagnostics(["local_ipv6","system_dns"]); }
    setMessage("配置已保存，相关项目已重新检测。");
  });
  const performRestore=()=>run(async()=>{
    const action=restore;setRestore(undefined);await invoke("cs_system_network_restore",{action});
    await refresh();await cs.scanDiagnostics(["local_ipv6","system_dns"]);cs.log("config","系统网络原配置已恢复");
    setMessage("原配置已恢复并重新检测。");
  });
  return <Card className="diagnostic-section system-configuration" title={recoveryOnly?"系统网络恢复":"配置修改"} action={<HelpTip label="系统网络配置">修改前会备份原配置，并请求 Windows 管理员权限。IPv6 全局关闭需要重启时，检测结果会明确显示。DNS 解析成功不会自动判为无泄漏。</HelpTip>}>
    {error&&<p className="error" role="alert">{error}</p>}{message&&<p className="env-note" role="status">{message}</p>}
    {recoveryOnly?<div className="actions"><Button disabled={locked||!data?.backups.ipv6.exists||data.backups.ipv6.phase==="unreadable"} onClick={()=>setRestore("disable_ipv6")}>恢复原 IPv6 配置</Button><Button disabled={locked||!data?.backups.dns.exists||data.backups.dns.phase==="unreadable"} onClick={()=>setRestore("set_dns")}>恢复原 DNS 配置</Button></div>:<>
      <div className="compact-settings">
        <label className="compact-setting"><span>IPv6 <HelpTip label="IPv6 策略">产品要求关闭系统 IPv6。若已有备份，请在高级与恢复中还原后再修改。</HelpTip></span><select value={ipv6?"disable":"keep"} disabled={locked||!data||!!data.backups.ipv6.exists} onChange={e=>setIpv6(e.target.value==="disable")}><option value="keep">保持当前配置</option><option value="disable">关闭 IPv6</option></select></label>
        <label className="compact-setting"><span>DNS 查询 <HelpTip label="DNS 方案">本机代理 DNS 需要代理软件在 127.0.0.1:53 提供 DNS 服务。公共 DNS 可启用系统 DoH；更换地址不代表已验证无直连泄漏。</HelpTip></span><select value={preset} disabled={locked||!data||!!data.backups.dns.exists} onChange={e=>setPreset(e.target.value)}><option value="keep">保持当前配置</option><option value="proxy">本机代理 DNS</option><option value="quad9">Quad9</option><option value="cloudflare">Cloudflare</option></select></label>
        {preset!=="keep"&&<div className="compact-setting"><span>应用网卡</span><div className="adapter-choices">{adapters.filter(a=>a.dnsAvailable).map(a=><label key={a.id}><input type="checkbox" checked={selected.includes(a.id)} disabled={locked} onChange={e=>setSelected(ids=>e.target.checked?[...ids,a.id]:ids.filter(id=>id!==a.id))}/>{a.name}</label>)}</div></div>}
        {preset!=="keep"&&preset!=="proxy"&&<label className="compact-setting"><span>加密 DNS <HelpTip label="加密 DNS">启用 Windows DoH 并禁止明文回退。系统不支持时无法启用。</HelpTip></span><span><input type="checkbox" checked={doh} disabled={locked||!data?.state.dohSupported} onChange={e=>setDoh(e.target.checked)}/> 使用 DoH</span></label>}
      </div>
      <div className="configuration-actions"><Button variant="primary" disabled={locked||!data||(!ipv6&&preset==="keep")||(preset!=="keep"&&!selected.length)} onClick={()=>void prepare()}>{busy?"处理中…":"应用并重新检测"}</Button></div>
      {(data?.backups.dns.exists||data?.backups.ipv6.exists)&&<Button variant="ghost" size="sm" onClick={()=>cs.setDiagnosticsTab("recovery")}>备份与恢复</Button>}
    </>}
    {plans&&<DecisionDialog title="确认修改系统网络" confirm="确认修改并检测" busy={busy} onCancel={()=>setPlans(undefined)} onConfirm={()=>void apply()}>
      <p>{plans.map(p=>p.change.action==="disable_ipv6"?"关闭系统 IPv6":`DNS 改为${p.change.preset==="proxy"?"本机代理 DNS":p.change.preset}`).join("；")}。</p>
      <p>影响网卡：{[...new Set(plans.flatMap(p=>p.change.adapterIds))].map(id=>adapters.find(a=>a.id===id)?.name??id).join("、")}</p><p>先备份原配置，再请求管理员权限。{plans.some(p=>p.change.action==="disable_ipv6")?"IPv6 修改可能需要重启电脑。":""}</p>
    </DecisionDialog>}
    {restore&&<DecisionDialog title="恢复系统网络配置" confirm="恢复并重新检测" busy={busy} onCancel={()=>setRestore(undefined)} onConfirm={()=>void performRestore()}><p>恢复原{restore==="disable_ipv6"?" IPv6 ":" DNS "}配置。检测到其他程序改动时会停止覆盖并保留备份。</p></DecisionDialog>}
  </Card>;
}

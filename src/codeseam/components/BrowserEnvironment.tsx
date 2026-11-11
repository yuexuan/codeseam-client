import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { currentMonitor } from "@tauri-apps/api/window";
import { ChevronDown, ExternalLink, RefreshCw } from "lucide-react";
import type { CodeSeam } from "../lib/useCodeSeam";
import type { CheckItem } from "../lib/types";
import { GROUPS, TITLES } from "../lib/diagnostics";
import { fullTime } from "../lib/format";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { HelpTip } from "./ui/HelpTip";
import { DecisionDialog } from "./ui/DecisionDialog";
import { ResultRow, ResultsHeading } from "./DiagnosticResults";
type Config={browserId:string;proxy:string;expectedIp:string;language:string;timezone:string;width:number;height:number;cores:number;blockWebrtc:boolean};
type BrowserReport={generatedAt:number;checks:CheckItem[]};
type Status={running:boolean;created:boolean;config:Config;runningBrowserId?:string;report?:BrowserReport;browsers:{id:string;installed:boolean}[]};
const BROWSERS=[{id:"chrome",name:"Chrome"},{id:"edge",name:"Edge"},{id:"firefox",name:"Firefox"}];
export function BrowserEnvironment({cs,onDirty}:{cs:CodeSeam;onDirty:(dirty:boolean)=>void}){
  const [selected,setSelected]=useState(()=>{const saved=localStorage.getItem("cs.browser.choice");return BROWSERS.some(b=>b.id===saved)?saved!:"chrome";});
  const [status,setStatus]=useState<Status>();
  const [config,setConfig]=useState<Config>();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [openChoice,setOpenChoice]=useState(false);
  const [choice,setChoice]=useState("chrome");
  const [confirmation,setConfirmation]=useState<"apply"|"destroy">();
  const epoch=useRef(0);
  const load=async(id=selected)=>{
    const token=++epoch.current;
    const next=await invoke<Status>("cs_browser_status",{browserId:id});
    if(!next?.config)throw new Error("浏览器环境需要在桌面客户端使用。");
    if(token!==epoch.current)return;
    if(!next.created){
      try{const monitor=await currentMonitor();if(monitor&&monitor.size.width>=800&&monitor.size.height>=600){next.config.width=monitor.size.width;next.config.height=monitor.size.height;}}catch{/* 原生后端也会在使用备用值前尝试读取主显示器。 */}
    }
    setStatus(next);setConfig(next.config);
    return next;
  };
  useEffect(()=>{setStatus(undefined);setConfig(undefined);setError("");void load(selected).catch(e=>setError(String(e)));return()=>{++epoch.current;};},[selected]);
  const dirty=!!status&&!!config&&JSON.stringify(config)!==JSON.stringify(status.config);
  useEffect(()=>{onDirty(dirty);},[dirty,onDirty]);
  useEffect(()=>{if(!status?.running)return;const timer=setInterval(()=>{if(busy||cs.scan)return;void invoke<Status>("cs_browser_status",{browserId:selected}).then(s=>{if(s?.config)setStatus(s);}).catch(()=>{});},5000);return()=>clearInterval(timer);},[selected,status?.running,busy,cs.scan]);
  useEffect(()=>{if(!cs.scan&&cs.report?.generatedAt)void invoke<Status>("cs_browser_status",{browserId:selected}).then(s=>{if(s?.config)setStatus(s);}).catch(()=>{});},[cs.report?.generatedAt,cs.scan,selected]);
  const locked=busy||cs.busy||cs.diagnosticsBusy||!!cs.scan;
  const run=async(action:()=>Promise<void>)=>{setBusy(true);cs.setDiagnosticsBusy(true);setError("");try{await action();}catch(e){setError(String(e));}finally{setBusy(false);cs.setDiagnosticsBusy(false);}};
  const test=async()=>{await cs.scanDiagnostics(GROUPS.browser);await load();};
  const start=async(next:Config)=>{
    const opened=await invoke<Status>("cs_browser_start",{config:next});
    setStatus(previous=>({...opened,browsers:opened.browsers??previous?.browsers??[]}));setConfig(opened.config);
    localStorage.setItem("cs.browser.choice",next.browserId);
    setOpenChoice(false);setConfirmation(undefined);
    if(next.browserId!==selected)setSelected(next.browserId);
    cs.log("config",`${BROWSERS.find(b=>b.id===next.browserId)?.name??"浏览器"} 环境已打开`);
    await cs.scanDiagnostics(GROUPS.browser);
    await load(next.browserId);
  };
  const change=<K extends keyof Config>(key:K,value:Config[K])=>setConfig(c=>c&&({...c,[key]:value}));
  const name=BROWSERS.find(b=>b.id===selected)!.name;
  const rows=GROUPS.browser.map(id=>{
    const scanning=cs.scan?.ids.includes(id)&&status?.running;
    return (scanning?cs.report?.checks.find(c=>c.id===id):undefined)??status?.report?.checks.find(c=>c.id===id)??{id,label:TITLES[id],status:status?.created?"not_checked":"not_created",detail:status?.created?"尚未检测":"创建环境后自动检测"};
  });
  return <div className="browser-environment">
    <div className="browser-tabs" role="tablist" aria-label="浏览器">
      {BROWSERS.map(b=><button role="tab" key={b.id} aria-selected={selected===b.id} disabled={locked} onClick={()=>{if(dirty){setError("请先保存配置或放弃修改。");return;}setSelected(b.id);}}>{b.name}{status?.browsers.find(v=>v.id===b.id)?.installed===false&&<small>未安装</small>}</button>)}
    </div>
    <div className="browser-identity"><div><h2>{name} 默认环境</h2><span>{status?.created?status.running?"运行中":"已保存 · 窗口已关闭":"未创建"}{status?.report?.generatedAt?` · 上次检测 ${fullTime(status.report.generatedAt*1000)}`:""}</span></div>
      <div className="actions"><Button variant="primary" disabled={locked||!config} onClick={()=>{setChoice(selected);setOpenChoice(true);}}>打开浏览器 <ChevronDown size={14}/></Button>
        {status?.running&&<Button disabled={locked} onClick={()=>void run(async()=>{await invoke("cs_browser_stop");await load();cs.log("info","浏览器窗口已关闭，环境已保留");})}>关闭窗口</Button>}</div>
    </div>
    {error&&<p className="error" role="alert">{error}</p>}
    <Card className="diagnostic-section" title="检测结果" action={<Button size="sm" variant="ghost" icon={<RefreshCw size={14}/>} disabled={locked||!status?.running||dirty} onClick={()=>void run(test)}>重新检测</Button>}>
      <ResultsHeading/>{rows.map(item=><ResultRow key={`${selected}-${item.id}`} item={item} time={status?.report?.generatedAt} onConfig={()=>["browser_dns","browser_ipv6"].includes(item.id)?cs.setDiagnosticsTab("system"):document.getElementById("browser-config")?.scrollIntoView({behavior:"smooth",block:"start"})}/>)}
    </Card>
    <div id="browser-config"><Card className="diagnostic-section" title="环境配置" action={<HelpTip label="保存的环境">首次创建时记录显示器尺寸和实际指纹。重新打开沿用该环境、登录会话和指纹基准。浏览器升级或硬件变更会报告差异，不会自动覆盖基准。</HelpTip>}>
      {config&&<form className="browser-settings" onSubmit={e=>{e.preventDefault();if(!status?.created){setChoice(selected);setOpenChoice(true);}else setConfirmation("apply");}}>
        <div className="browser-fields"><label className="env-field">语言<input required value={config.language} disabled={locked} onChange={e=>change("language",e.target.value)}/></label>
          <label className="env-field">时区<input required value={config.timezone} disabled={locked} onChange={e=>change("timezone",e.target.value)}/></label>
          <div className="env-field"><div>分辨率 <HelpTip label="分辨率">首次取当前显示器尺寸，无法读取时使用默认值。保存后固定沿用，不随窗口或显示器变化自动重置。</HelpTip></div><div className="resolution-input"><input aria-label="屏幕宽度" type="number" min={800} max={16384} required disabled={locked} value={config.width} onChange={e=>change("width",Number(e.target.value))}/><span>×</span><input aria-label="屏幕高度" type="number" min={600} max={16384} required disabled={locked} value={config.height} onChange={e=>change("height",Number(e.target.value))}/></div></div></div>
        <div className="browser-options"><label><input type="checkbox" checked={config.blockWebrtc} disabled={locked} onChange={e=>change("blockWebrtc",e.target.checked)}/> WebRTC 直连保护</label><span>网络：沿用代理与网络配置 <Button type="button" size="sm" variant="ghost" disabled={locked} onClick={()=>cs.setDiagnosticsTab("network")}>查看 <ExternalLink size={12}/></Button></span></div>
        <div className="configuration-actions"><Button type="button" className="text-danger" variant="ghost" disabled={locked||!status?.created} onClick={()=>setConfirmation("destroy")}>销毁环境</Button><div className="actions">{dirty&&<Button type="button" disabled={locked} onClick={()=>setConfig(status?.config)}>放弃修改</Button>}<Button type="submit" variant="primary" disabled={locked||!dirty}>{status?.created?"保存并重新检测":"创建并检测"}</Button></div></div>
      </form>}
    </Card></div>
    {openChoice&&<DecisionDialog title="选择要打开的浏览器" confirm="打开并检测" busy={busy} onCancel={()=>setOpenChoice(false)} onConfirm={()=>void run(async()=>{
      if(status?.browsers.find(b=>b.id===choice)?.installed===false)throw new Error("请先选择已安装的浏览器");
      const next=choice===selected?config:(await invoke<Status>("cs_browser_status",{browserId:choice})).config;
      if(!next)throw new Error("浏览器配置未读取");
      await start(next);setOpenChoice(false);
    })}>{error&&<p className="error" role="alert">{error}</p>}<div className="browser-choices">{BROWSERS.map(b=><label key={b.id}><input type="radio" name="browser" value={b.id} checked={choice===b.id} disabled={busy||status?.browsers.find(v=>v.id===b.id)?.installed===false} onChange={()=>setChoice(b.id)}/>{b.name}{status?.browsers.find(v=>v.id===b.id)?.installed===false&&<small>未安装</small>}</label>)}</div>{status?.runningBrowserId&&<p>会关闭当前受管窗口并保留会话，再打开所选环境。请先保存页面工作。</p>}</DecisionDialog>}
    {confirmation&&<DecisionDialog title={confirmation==="destroy"?"销毁浏览器环境":"保存浏览器配置"} confirm={confirmation==="destroy"?"销毁环境":"保存并重新检测"} danger={confirmation==="destroy"} busy={busy} onCancel={()=>setConfirmation(undefined)} onConfirm={()=>void run(async()=>{
      if(confirmation==="destroy"){await invoke("cs_browser_destroy",{browserId:selected,confirmed:true});await load();cs.log("config",`${name} 环境已销毁`);}else if(config){await start(config);}
      setConfirmation(undefined);
    })}><p>{confirmation==="destroy"?"将关闭窗口并删除此环境的登录会话、指纹基准和检测记录。其他浏览器环境不受影响。":status?.running?"将关闭当前受管窗口，保存配置后重新打开并检测。请先保存页面工作。":"将保存配置并打开此浏览器环境，随后自动检测。"}</p>{error&&<p className="error" role="alert">{error}</p>}</DecisionDialog>}
  </div>;
}

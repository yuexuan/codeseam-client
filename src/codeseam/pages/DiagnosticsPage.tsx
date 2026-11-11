import { useEffect, useRef, useState } from "react";
import { FileDown, FolderOpen, LoaderCircle, MoreHorizontal, Play, ScrollText } from "lucide-react";
import type { CodeSeam } from "../lib/useCodeSeam";
import type { CheckItem, DiagnosticsTab, PageId } from "../lib/types";
import { fullTime } from "../lib/format";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { PageHeader } from "../components/ui/PageHeader";
import { HelpTip } from "../components/ui/HelpTip";
import { SgNode } from "../components/SgNode";
import { ManagedConfig } from "../components/ManagedConfig";
import { BrowserEnvironment } from "../components/BrowserEnvironment";
import { SystemNetwork } from "../components/SystemNetwork";
import "../styles/diagnostics.css";

import { TABS, GROUPS, TITLES } from "../lib/diagnostics";
import { ResultRow, ResultsHeading } from "../components/DiagnosticResults";
export function DiagnosticsPage({ cs, setPage }: { cs: CodeSeam; setPage: (p: PageId) => void }) {
  const { status, report, busy, diagnosticsTab: tab } = cs;
  const [visited,setVisited] = useState<Set<DiagnosticsTab>>(()=>new Set([tab]));
  const [more, setMore] = useState(false);
  const [nodeDirty, setNodeDirty] = useState(false);
  const [browserDirty, setBrowserDirty] = useState(false);
  const [systemDirty, setSystemDirty] = useState(false);
  useEffect(() => { cs.setDiagnosticsDirty(nodeDirty || browserDirty || systemDirty); }, [nodeDirty, browserDirty, systemDirty, cs.setDiagnosticsDirty]);
  const nodeRef = useRef<HTMLDivElement>(null);
  const claudeRef = useRef<HTMLDivElement>(null);
  const locked = busy || cs.diagnosticsBusy || !!cs.scan;
  const checks = report?.checks ?? [];
  const byId = new Map(checks.map(c => [c.id, c]));
  const profile = status?.network?.region_profile;
  useEffect(() => { void cs.loadCliInfo(); }, [cs.loadCliInfo]);
  const exportReport = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `codeseam-diagnostics-${report.generatedAt ?? Date.now()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setMore(false);
  };
  const missing = (id: string): CheckItem => ({ id, label: TITLES[id] ?? id, status: "not_checked", detail: "尚未检测", });
  const ids = (group: DiagnosticsTab) => GROUPS[group].filter(id => byId.has(id) || !["windows_environment", "sg_node"].includes(id));
  const renderChecks = (group: DiagnosticsTab) => [...ids(group), ...(group === "network" ? checks.filter(c => !new Set(Object.values(GROUPS).flat()).has(c.id)).map(c => c.id) : [])].map(id => {
    let item = byId.get(id) ?? missing(id);
    if (id === "initialization") item = { ...item, status: "unsupported", detail: "尚未接管 Clash；没有自动初始化或恢复的路由变更。" };
    return <ResultRow key={id} item={item} time={report?.generatedAt}
      onConfig={group === "system" ? () => document.getElementById("system-configuration")?.scrollIntoView({behavior:"smooth",block:"start"}) : id === "config" ? () => claudeRef.current?.scrollIntoView({ block: "nearest" }) : id === "sg_profile" || id === "sg_node" ? () => nodeRef.current?.scrollIntoView({ block: "nearest" }) : undefined} />;
  });
  const scopedChecks=checks.filter(c=>GROUPS[tab].includes(c.id));
  const hasResult=scopedChecks.some(c=>!["not_checked","waiting","running"].includes(c.status));
  const failures = scopedChecks.filter(c => c.status === "fail").length;
  const pending = scopedChecks.filter(c => ["unknown","warning","reboot_required","interrupted"].includes(c.status)).length;
  const select = (next: DiagnosticsTab) => { setVisited(v=>new Set([...v,next])); cs.setDiagnosticsTab(next); setMore(false); };
  return <div className="diagnostics-workspace">
    <PageHeader title="环境诊断" actions={<>
      <Button variant="primary" icon={cs.scan?<LoaderCircle size={14} className="check-spin"/>:<Play size={13}/>} disabled={locked} onClick={() => void cs.run("cs_diagnose")}>{cs.scan ? "检测中…" : "检测全部"}</Button>
      <div className="env-more"><Button aria-label="更多诊断操作" aria-expanded={more} icon={<MoreHorizontal size={16} />} onClick={() => setMore(v => !v)} />
        {more && <div className="env-more-panel" onKeyDown={e => { if (e.key === "Escape") setMore(false); }}><Button disabled={!report || locked} icon={<FileDown size={14} />} onClick={exportReport}>导出最近报告</Button></div>}</div>
    </>} />
    <div className="env-tabs" role="tablist" aria-label="环境诊断分区">
      {TABS.map((t, index) => {
        const count = checks.filter(c => GROUPS[t.id].includes(c.id) && (c.status === "fail" || c.status === "warning")).length;
        return <button key={t.id} id={`env-tab-${t.id}`} role="tab" aria-label={t.label} aria-selected={tab === t.id} aria-controls={`env-panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
          onClick={() => select(t.id)} onKeyDown={e => {
            if(e.ctrlKey||e.metaKey||e.altKey)return;
            const next = e.key === "ArrowRight" ? (index + 1) % TABS.length : e.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : undefined;
            if (next !== undefined) { e.preventDefault(); select(TABS[next].id); document.getElementById(`env-tab-${TABS[next].id}`)?.focus(); }
          }}>{t.label}{count > 0 && <span className="env-tab-count">{count}</span>}</button>;
      })}
    </div>
    {(tab!=="browser"||cs.scan)&&<div className="env-summary" role="status" aria-live="polite">
      <strong>{cs.scan ? `正在检测${TITLES[cs.scan.current??""]??"环境"} · ${cs.scan.done} / ${cs.scan.ids.length} 项完成` : !hasResult?"尚未检测此分区":`检测完成 · ${scopedChecks.filter(c=>c.status==="pass").length} 项通过${failures?`，${failures} 项未通过`:""}${pending?`，${pending} 项需配置`:""}`}</strong>
      {!cs.scan&&hasResult&&report?.generatedAt&&<span>上次检测：{fullTime(report.generatedAt*1000)}</span>}
    </div>}
    {cs.scan&&<progress className="scan-progress" aria-label="检测进度" max={cs.scan.ids.length} value={cs.scan.done}/>}
    {TABS.filter(t=>visited.has(t.id)||t.id===tab).map(t => <div key={t.id} id={`env-panel-${t.id}`} role="tabpanel" aria-labelledby={`env-tab-${t.id}`} tabIndex={0} hidden={tab !== t.id} className="env-panel">
      {t.id === "system" && <>
        <Card className="diagnostic-section" title="检测结果"><ResultsHeading/>{renderChecks("system")}</Card>
        <div id="system-configuration"><SystemNetwork cs={cs} onDirty={setSystemDirty}/></div>
      </>}
      {t.id === "browser" && <BrowserEnvironment cs={cs} onDirty={setBrowserDirty} />}
      {t.id === "network" && <>
        <Card className="diagnostic-section" title="检测结果"><ResultsHeading/>{renderChecks("network")}</Card>
        <details className="env-secondary-details"><summary>服务下发的区域配置</summary><dl className="env-facts">
          <div><dt>注册 / 运行地区</dt><dd>{profile?.registration_region || "未登记"} / {profile?.region || "未下发"}</dd></div>
          <div><dt>指定节点</dt><dd>{profile?.clash_node || "未分配"}</dd></div><div><dt>预期固定出口</dt><dd>{profile?.expected_egress_ipv4 || status?.network?.expected_egress || "未分配"}</dd></div>
          <div><dt>来源 / 配置版本</dt><dd>{status?.network ? `服务端下发 / ${profile?.version || status.network.revision}` : "未取得服务配置"}</dd></div>
        </dl></details>
        <div ref={nodeRef}><Card className="diagnostic-section" title="配置修改" action={<HelpTip label="本地节点">配置和测试是独立操作；测试只使用已保存节点。未应用草稿在切换分区后保留。</HelpTip>}>
          <SgNode disabled={locked} onDirty={setNodeDirty} onBusy={cs.setDiagnosticsBusy} onSaved={() => { cs.log("config", "本地节点配置已更新"); return cs.scanDiagnostics(["local_sg_node"]); }} />
        </Card></div>
      </>}
      {t.id === "claude" && <>
        <Card className="diagnostic-section" title="检测结果"><ResultsHeading/>
          <ResultRow item={{ id: "cli_executable", label: "可执行程序与版本", status: status?.cli && cs.cliInfo?.version ? "pass" : "unknown", detail: `${status?.cli ?? "未检测到程序"} · ${cs.cliInfo?.version ?? "版本未读取"}` }} />
          {renderChecks("claude")}
          <ResultRow item={{ id: "preflight", label: "启动前验证", status: report?.apiProtection ?? "unknown", detail: !report ? "尚未进行启动前检测" : report.apiProtection === "skipped" ? "尚未接入受管 API 服务，启动条件待验证" : report.canStart ? "当前报告允许受管 API 启动；实际启动时仍重新检测。" : "当前报告尚不满足受管启动条件" }} />
        </Card>
        <div ref={claudeRef}><Card title="受管配置"><ManagedConfig cs={cs} /></Card></div>
        <Card title="启动与会话"><Button disabled={locked} onClick={() => setPage("claude")}>前往 Claude Code 控制台</Button></Card>
      </>}
      {t.id === "recovery" && <>
        <Card title="诊断资料"><div className="actions"><Button disabled={!report || locked} icon={<FileDown size={14} />} onClick={exportReport}>导出最近报告</Button>
          <Button disabled={locked} icon={<FolderOpen size={14} />} onClick={() => void cs.run("cs_open_path", { kind: "claude" })}>打开配置目录</Button>
          <Button disabled={locked} icon={<ScrollText size={14} />} onClick={() => { cs.setSettingsTab("logs"); setPage("settings"); }}>查看全部活动记录</Button></div>
          <div className="env-activity">{cs.activity.slice(0, 5).map((ev, i) => <div key={`${ev.ts}-${i}`}><time>{fullTime(ev.ts)}</time><span>{ev.title}</span></div>)}{!cs.activity.length && <p>暂无活动记录</p>}</div>
        </Card>
        <Card title="配置恢复">{renderChecks("recovery")}<ManagedConfig cs={cs} restoreOnly /></Card>
        <SystemNetwork cs={cs} onDirty={setSystemDirty} recoveryOnly/>
        <Card title="其他恢复对象"><dl className="env-facts"><div><dt>系统网络</dt><dd>IPv6 与 DNS 的原配置可在上方恢复。</dd></div><div><dt>Clash 自动接管</dt><dd>暂不支持；没有可恢复的自动接管变更。</dd></div></dl></Card>
      </>}
    </div>)}
  </div>;
}

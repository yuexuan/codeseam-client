import { useEffect, useId, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "./ui/Button";
import { HelpTip } from "./ui/HelpTip";
import { Badge } from "./ui/Badge";

export function SgNode({ disabled = false, onDirty, onBusy, onSaved }: {
  disabled?: boolean; onDirty?: (dirty: boolean) => void; onBusy?: (busy: boolean) => void; onSaved?: () => void | Promise<void>;
}) {
  const fieldId = useId();
  const [uri, setUri] = useState("");
  const [expected, setExpected] = useState("");
  const [savedExpected, setSavedExpected] = useState("");
  const [configured, setConfigured] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{ip:string;expectedMatch:boolean|null}>();
  const dirty = !!uri || expected !== savedExpected;
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  const refresh = async () => {
    const s = await invoke<{configured:boolean;expected?:string}>("cs_sg_status");
    setConfigured(s.configured); setExpected(s.expected ?? ""); setSavedExpected(s.expected ?? ""); setLoaded(true);
  };
  useEffect(() => { void refresh().catch(() => setError("无法读取本地节点，请确认客户端已更新。")); }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); onBusy?.(true); setError(""); setMessage("");
    try { await action(); } catch(e) { setError(String(e)); } finally { setBusy(false); onBusy?.(false); }
  };
  const locked = busy || disabled;
  return <div className="sg-node env-node">
    <div className="env-inline"><Badge tone="neutral">{!loaded ? "节点状态未读取" : configured ? "节点已加密保存" : "尚未保存节点"}</Badge>
      {dirty && <Badge tone="amber">未应用</Badge>}</div>
    <form className="env-node-form" onSubmit={e => {
      e.preventDefault();
      void run(async () => {
        await invoke("cs_sg_import", {uri, expected: expected || null});
        setUri(""); setResult(undefined); await refresh(); if(onSaved)await onSaved();else setResult(await invoke("cs_sg_probe")); setMessage("节点已保存，检测结果已更新。");
      });
    }}>
      <div className="env-field"><div><label htmlFor={`${fieldId}-uri`}>SS 节点链接</label><HelpTip label="SS 节点链接">粘贴 ss:// 链接。使用本机加密存储；保存后清空，不回显密码。更换将覆盖已保存节点。</HelpTip></div>
        <input id={`${fieldId}-uri`} type="password" autoComplete="off" value={uri} placeholder={configured ? "粘贴新链接以更换节点" : "ss://…"} required
          disabled={locked || !loaded} onChange={e => setUri(e.target.value)} /></div>
      <div className="env-field"><div><label htmlFor={`${fieldId}-expected`}>预期出口 IPv4（可选）</label><HelpTip label="预期出口">仅用于本地节点出口测试，不覆盖服务下发的固定出口。修改时需同时重新粘贴节点链接并保存。</HelpTip></div>
        <input id={`${fieldId}-expected`} value={expected} disabled={locked || !loaded} placeholder="留空时只报告实测出口" onChange={e => setExpected(e.target.value)} /></div>
      <div className="actions"><Button type="submit" disabled={locked || !loaded || !uri.trim()}>保存并检测</Button>
        {dirty && <Button type="button" disabled={locked} onClick={() => { setUri(""); setExpected(savedExpected); }}>放弃编辑</Button>}</div>
    </form>
    <div className="actions">
      <Button disabled={!configured || locked || dirty} onClick={() => void run(async () => {
        setResult(undefined); if(onSaved)await onSaved();else setResult(await invoke("cs_sg_probe"));
      })}>{busy ? "处理中…" : "测试已保存节点出口"}</Button>
      <Button disabled={!configured || locked || dirty} onClick={() => setRemoving(true)}>移除本地节点</Button>
      {!loaded && <Button disabled={locked} onClick={() => void run(refresh)}>重新读取节点</Button>}
    </div>
    {removing && <div className="env-notice"><p>将删除本机加密保存的节点凭据。现有 Clash 配置不会修改；再次测试需重新导入。</p><div className="actions">
      <Button disabled={locked} onClick={() => void run(async () => {
        await invoke("cs_sg_remove"); setResult(undefined); setRemoving(false); await refresh(); onSaved?.(); setMessage("本地节点已移除。");
      })}>确认移除节点</Button><Button disabled={locked} onClick={() => setRemoving(false)}>取消</Button></div></div>}
    {error && <p role="alert" className="error">{error}</p>}
    {message && <p role="status" className="env-note">{message}</p>}
    {result && <p role="status" className="env-notice">实测出口：{result.ip} · {result.expectedMatch === null ? "未设置预期 IP，未验证匹配" : result.expectedMatch ? "与已保存预期一致" : "与已保存预期不一致"}</p>}
    <HelpTip label="节点检测范围">验证本次 HTTPS 请求能否经所保存的节点连接，并核对预期出口。浏览器会复用此节点；API 路径、地区和 UDP 分别检测。</HelpTip>
  </div>;
}

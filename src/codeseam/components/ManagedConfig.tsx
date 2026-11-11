import { useEffect, useState } from "react";
import { FolderOpen, ShieldCheck } from "lucide-react";
import type { CodeSeam } from "../lib/useCodeSeam";
import { Button } from "./ui/Button";
import { HelpTip } from "./ui/HelpTip";
import { Badge } from "./ui/Badge";

/** 两个诊断 Tab 与启动页面共享相同的备份事实和原生命令。 */
export function ManagedConfig({ cs, restoreOnly = false }: { cs: CodeSeam; restoreOnly?: boolean }) {
  const [consent, setConsent] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const { status, cliInfo: info, busy, configChange, report } = cs;
  useEffect(() => { void cs.loadCliInfo(); }, [status?.configured, cs.loadCliInfo]);
  useEffect(() => { setConsent(false); setRestoring(false); }, [configChange]);
  const recovery = info?.recovery_state;
  const blocked = busy || cs.diagnosticsBusy ? "正在执行操作，请稍候。" : status?.cli_pid ? "请先关闭受管 Claude Code 终端。" :
    recovery === "conflict" ? "配置与备份冲突或备份不可读，已停止覆盖；请检查配置目录。" : "";
  const restoreReason = blocked || (recovery === "clean" ? "没有可恢复的备份。" : recovery !== "pending_restore" ? "尚未读取到可用备份。" : "");
  const applyReason = blocked || (!status?.proxy_running ? "本地代理未运行，请先激活服务。" :
    !info?.settings_readable ? "配置尚未读取或格式无效，不能应用。" : !consent ? "请确认备份和下方变更范围。" : "");
  const check = report?.checks.find(c => c.id === "config");
  const rechecked = configChange && report?.generatedAt && report.generatedAt * 1000 >= Math.floor(configChange.at / 1000) * 1000;
  const result = configChange ? rechecked ? configChange.kind === "restore" ? "恢复后检测已完成，请查看检测结果" :
    check?.status === "pass" ? "配置验证通过（仅 API 配置）" : check?.status === "fail" ? "配置验证失败" : "检测已完成，配置仍待验证" :
    configChange.kind === "restore" ? "已恢复，待验证" : "已应用，待验证" : undefined;
  return <div className="managed-config">
    <div className="env-inline">
      <span>Claude API 配置</span>
      <Badge tone="neutral">{recovery === "pending_restore" ? "有加密备份" : recovery === "conflict" ? "恢复冲突" : recovery === "clean" ? "无备份" : "备份状态未读取"}</Badge>
      <HelpTip label="受管配置">只修改 settings.json 中的三个受管 API 字段，保留其他设置。真实服务授权不写入普通 CLI 配置。</HelpTip>
    </div>
    <p className="env-path">{info?.settings_path ?? "配置路径尚未读取"}</p>
    {!restoreOnly && <>
      <div className="env-table-wrap"><table className="env-table"><thead><tr><th>字段</th><th>当前值（脱敏）</th><th>应用后</th></tr></thead>
        <tbody>{[
          ["ANTHROPIC_BASE_URL", status?.local_url ?? "本地代理地址尚未读取"],
          ["ANTHROPIC_AUTH_TOKEN", "本地受管占位授权（非服务密钥）"],
          ["ANTHROPIC_API_KEY", "移除该字段"],
        ].map(([field, next]) => <tr key={field}><td className="mono">{field}</td><td>{info?.managed_fields?.[field] ?? "未读取"}</td><td>{next}</td></tr>)}</tbody>
      </table></div>
      <label className="consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />我确认备份原配置，仅应用上表中的 API 字段变更。</label>
      <div className="actions"><Button icon={<ShieldCheck size={14} />} disabled={!!applyReason}
        onClick={() => void cs.run("cs_configure", { confirmed: consent })}>{cs.activeCommand === "cs_configure" ? "应用中…" : "备份并应用"}</Button></div>
      {applyReason && <p className="env-note">{applyReason}</p>}
    </>}
    {result && <p role="status" className="env-notice">{result}。网络保护结论以各路径检测为准。</p>}
    {cs.error && <p className="error" role="alert">{cs.error}</p>}
    <div className="actions">
      <Button disabled={!!restoreReason || restoring} onClick={() => setRestoring(true)}>恢复原配置</Button>
      <Button icon={<FolderOpen size={14} />} disabled={busy} onClick={() => void cs.run("cs_open_path", { kind: "claude" })}>打开配置目录</Button>
    </div>
    {restoreReason && <p className="env-note">{restoreReason}</p>}
    {restoring && <div className="env-notice" role="group" aria-label="恢复确认">
      <p>将从加密备份还原 Claude API 的三个受管字段，保留其他设置。外部字段变更冲突时停止恢复；成功后移除该备份，需重新检测。</p>
      <div className="actions"><Button disabled={!!restoreReason} onClick={() => void cs.run("cs_restore")}>{cs.activeCommand === "cs_restore" ? "恢复中…" : "确认恢复 Claude API 配置"}</Button>
        <Button disabled={busy} onClick={() => setRestoring(false)}>取消</Button></div>
    </div>}
  </div>;
}

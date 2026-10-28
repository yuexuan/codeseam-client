import {
  Activity,
  ChevronRight,
  Copy,
  FileDown,
  Globe,
  Layers,
  ListChecks,
  Lock,
  Network,
  Play,
  Radio,
  RotateCw,
  Route,
  ScrollText,
  Server,
  ShieldAlert,
  ShieldCheck,
  SquareTerminal,
  Stethoscope,
  Video,
  Wrench,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { CodeSeam } from "../lib/useCodeSeam";
import type { CheckItem, PageId, Report } from "../lib/types";
import { checkText, fullTime } from "../lib/format";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { PageHeader } from "../components/ui/PageHeader";
import { ManagedConfig } from "../components/ManagedConfig";

type Tone = "ok" | "pending" | "bad" | "idle";

/** 诊断项的展示信息；顺序即列表顺序。后端新增的检测项会追加到末尾并使用后端文案。 */
const META: Record<string, { title: string; desc: string; icon: ReactNode }> = {
  proxy: { title: "本地代理", desc: "检测受管代理服务运行状态与配置", icon: <Server /> },
  config: { title: "Claude Code 配置", desc: "检查受管配置与本地端口是否一致", icon: <SquareTerminal /> },
  egress_ipv4: { title: "出口 IP", desc: "检测当前网络出口 IP 及预期匹配", icon: <Globe /> },
  dns: { title: "DNS 泄漏", desc: "检测是否存在 DNS 泄漏风险", icon: <Network /> },
  egress_ipv6: { title: "IPv6 状态", desc: "检测 IPv6 连接状态与旁路风险", icon: <Route /> },
  udp: { title: "UDP 路由", desc: "检测 UDP 路径是否在保护范围内", icon: <Radio /> },
  webrtc: { title: "WebRTC / STUN", desc: "检测 WebRTC 是否泄漏真实 IP", icon: <Video /> },
  kill_switch: { title: "Kill-Switch", desc: "检测代理断开时的网络保护机制", icon: <Lock /> },
  non_api: { title: "非 API 流量", desc: "Claude Code 其他联网进程的覆盖范围", icon: <Layers /> },
};
const ORDER = Object.keys(META);

const STATUS_TEXT: Record<string, string> = {
  pass: "正常",
  fail: "异常",
  warning: "待处理",
  unknown: "待验证",
  not_applicable: "不适用",
};

const toneOf = (status?: string): Tone =>
  status === "pass"
    ? "ok"
    : status === "fail"
      ? "bad"
      : status === "warning" || status === "unknown"
        ? "pending"
        : "idle";

const statusLabel = (status?: string) => (status ? (STATUS_TEXT[status] ?? status) : "未检测");

const badgeTone = { ok: "green", pending: "amber", bad: "red", idle: "neutral" } as const;

interface Row {
  id: string;
  title: string;
  desc: string;
  icon: ReactNode;
  check?: CheckItem;
}

/** 环境诊断页：状态结论 + 诊断项目/详情 + 常用操作 + 修复与恢复。 */
export function DiagnosticsPage({ cs, setPage }: { cs: CodeSeam; setPage: (p: PageId) => void }) {
  const { status, report, busy, diagMs } = cs;
  const [picked, setPicked] = useState<string>();
  const [copied, setCopied] = useState(false);
  const detailRef = useRef<HTMLElement>(null);

  const rows = useMemo<Row[]>(() => {
    const byId = new Map((report?.checks ?? []).map((c) => [c.id, c]));
    const ids = [...ORDER, ...[...byId.keys()].filter((id) => !(id in META))];
    return ids.map((id) => {
      const check = byId.get(id);
      const m = META[id];
      return {
        id,
        title: m?.title ?? check?.label ?? id,
        desc: m?.desc ?? check?.detail ?? "",
        icon: m?.icon ?? <Stethoscope />,
        check,
      };
    });
  }, [report]);

  /** 默认选中首个需要关注的项（失败优先），无则首项。 */
  const firstIssue =
    rows.find((r) => toneOf(r.check?.status) === "bad") ??
    rows.find((r) => toneOf(r.check?.status) === "pending");
  const selected = rows.find((r) => r.id === picked) ?? firstIssue ?? rows[0];
  const sel = selected.check;
  const selTone = toneOf(sel?.status);

  const counts = {
    bad: rows.filter((r) => toneOf(r.check?.status) === "bad").length,
    pending: rows.filter((r) => toneOf(r.check?.status) === "pending").length,
  };

  const canDiagnose = !busy && !!status?.network;
  const diagnose = () => void cs.run("cs_diagnose");

  const exportReport = (r: Report) => {
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `codeseam-diagnostics-${r.generatedAt ?? Math.floor(Date.now() / 1000)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const locateAdvice = () => {
    if (!firstIssue) return;
    setPicked(firstIssue.id);
    detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const copyEvidence = async () => {
    if (!sel?.evidence) return;
    try {
      await navigator.clipboard.writeText(sel.evidence);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时静默忽略，证据仍显示在详情中。 */
    }
  };

  const heroTone: Tone = !report ? "idle" : counts.bad ? "bad" : "ok";
  const heroTitle = !report
    ? "尚未检测"
    : counts.bad
      ? "存在阻断问题"
      : "当前环境可用于 Claude Code";
  const heroSub = !report
    ? "激活服务后点击“开始检测”。未检测不代表正常。"
    : counts.bad
      ? `${counts.bad} 项检测未通过，受管请求不会被放行，请先处理标红项目。`
      : counts.pending
        ? `未发现阻断问题，建议关注 ${counts.pending} 项待验证项以获得更稳定的体验。`
        : "未发现阻断问题，所有检测项均正常。";

  const expectedEgress = status?.network?.expected_egress;
  const details: [string, ReactNode][] = [["检查项目", selected.title]];
  if (sel) {
    details.push(["检测结果", <Badge tone={badgeTone[selTone]}>{statusLabel(sel.status)}</Badge>]);
    if (sel.id === "egress_ipv4" && expectedEgress) details.push(["预期出口", expectedEgress]);
    if (sel.id === "proxy" && status?.network)
      details.push(["配置版本", status.network.revision.slice(0, 12)]);
    if (sel.evidence) details.push(["检测证据", <span className="mono">{sel.evidence}</span>]);
    if (sel.protected !== undefined)
      details.push(["保护范围", sel.protected ? "API 请求（失败将阻止启动）" : "仅提示，不阻断启动"]);
  }

  return (
    <>
      <PageHeader
        title="环境诊断"
        subtitle="检测本地环境、代理配置、网络连通性与安全性，确保能够稳定、安全地使用 Claude Code。"
        actions={
          <Button variant="primary" icon={<Play size={13} />} disabled={!canDiagnose} onClick={diagnose}>
            开始检测
          </Button>
        }
      />

      <div className="diag-stack">
        {/* 诊断状况 */}
        <section className="card diag-card">
          <div className="diag-head">
            <Stethoscope />
            <h2>诊断状况</h2>
          </div>
          <div className="diag-hero">
            <span className={`hero-badge hero-badge--${heroTone}`}>
              <span>{heroTone === "bad" ? <ShieldAlert /> : <ShieldCheck />}</span>
            </span>
            <div className="hero-main">
              <div className="hero-line">
                <strong className={`hero-title hero-title--${heroTone}`}>{heroTitle}</strong>
                {report && (
                  <>
                    <Badge tone={badgeTone[toneOf(report.apiProtection)]}>
                      API 请求：{checkText[report.apiProtection] ?? report.apiProtection}
                    </Badge>
                    <Badge tone="amber">非 API 流量：未覆盖</Badge>
                  </>
                )}
              </div>
              <p>{heroSub}</p>
            </div>
            <dl className="hero-meta">
              <dt>上次检测时间</dt>
              <dd>{report?.generatedAt ? fullTime(report.generatedAt * 1000) : "—"}</dd>
              <dt>检测耗时</dt>
              <dd>{diagMs != null && report ? `${(diagMs / 1000).toFixed(1)} 秒` : "—"}</dd>
            </dl>
            <Button
              className="btn--soft"
              icon={<RotateCw size={13} />}
              disabled={!canDiagnose}
              onClick={diagnose}
            >
              重新检测
            </Button>
          </div>
        </section>

        {/* 诊断项目 + 详情 */}
        <section className="card diag-card diag-split">
          <div className="diag-list">
            <div className="diag-head">
              <ListChecks />
              <h2>诊断项目</h2>
            </div>
            <div className="diag-rows" role="listbox" aria-label="诊断项目">
              {rows.map((r) => {
                const tone = toneOf(r.check?.status);
                return (
                  <button
                    key={r.id}
                    role="option"
                    aria-selected={r.id === selected.id}
                    className={`diag-row${r.id === selected.id ? " selected" : ""}`}
                    onClick={() => setPicked(r.id)}
                  >
                    <span className="row-icon">{r.icon}</span>
                    <span className="row-main">
                      <strong>{r.title}</strong>
                      <small>{r.desc}</small>
                    </span>
                    <span className={`row-status row-status--${tone}`}>
                      <i />
                      {statusLabel(r.check?.status)}
                    </span>
                    <ChevronRight className="row-chev" />
                  </button>
                );
              })}
            </div>
          </div>

          <aside className="diag-detail" ref={detailRef}>
            <div className="diag-head">
              {META[selected.id]?.icon ?? <Stethoscope />}
              <h2>{selected.title}详情</h2>
              <span className={`row-status row-status--${selTone} head-status`}>
                <i />
                {statusLabel(sel?.status)}
              </span>
            </div>
            <div className={`diag-alert diag-alert--${selTone}`}>
              {sel ? (
                <>
                  <p>{sel.detail}</p>
                  {sel.remediation && <p>建议：{sel.remediation}</p>}
                </>
              ) : (
                <p>
                  {report
                    ? "本次检测没有返回该项结果。"
                    : "尚未检测此项。点击“开始检测”后将显示证据与建议。未检测不代表正常。"}
                </p>
              )}
            </div>
            <dl className="diag-kv">
              {details.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            {sel?.evidence && (
              <Button className="btn--soft" icon={<Copy size={13} />} onClick={() => void copyEvidence()}>
                {copied ? "已复制" : "复制证据"}
              </Button>
            )}
          </aside>
        </section>

        {/* 常用操作 */}
        <section className="card diag-card">
          <div className="diag-head diag-head--line">
            <Wrench />
            <h2>常用操作</h2>
          </div>
          <div className="diag-actions">
            <ActionTile
              icon={<RotateCw />}
              title="重新检测"
              desc="立即重新运行所有检测项"
              disabled={!canDiagnose}
              onClick={diagnose}
            />
            <ActionTile
              icon={<FileDown />}
              title="导出报告"
              desc="导出诊断结果为本地文件"
              disabled={!report}
              onClick={() => report && exportReport(report)}
            />
            <ActionTile
              icon={<Activity />}
              title="网络修复建议"
              desc="定位首个需处理项的建议"
              disabled={!firstIssue}
              onClick={locateAdvice}
            />
            <ActionTile
              icon={<ScrollText />}
              title="查看记录"
              desc="查看活动记录与报告"
              disabled={busy}
              onClick={() => {
                cs.setSettingsTab("logs");
                setPage("settings");
              }}
            />
          </div>
        </section>

        <Card
          title="修复与恢复"
          subtitle="仅修改受管的 Claude API 字段，保留加密备份；系统 DNS、IPv6 和防火墙不会被此操作修改。"
        >
          <ManagedConfig cs={cs} />
        </Card>
      </div>
    </>
  );
}

function ActionTile({
  icon,
  title,
  desc,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button className="action-tile" disabled={disabled} onClick={onClick}>
      <span className="tile-icon tile-icon--gold">{icon}</span>
      <span>
        <strong>{title}</strong>
        <small>{desc}</small>
      </span>
    </button>
  );
}

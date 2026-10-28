import { useMemo, useState } from "react";
import { Clock, Hash, Layers, MessageSquare } from "lucide-react";
import type { CodeSeam } from "../../lib/useCodeSeam";
import type { UsageReport } from "../../lib/types";
import {
  buildDays,
  buildSessions,
  compact,
  duration,
  full,
  modelName,
  pct,
} from "../../lib/usage";
import { Card } from "../../components/ui/Card";
import { Donut, TrendChart, type Slice } from "../../components/usage/Charts";
import { LogTable, SessionTable } from "../../components/usage/Tables";
import { UsageStat } from "../../components/usage/UsageStat";

export interface UsageViewProps {
  cs: CodeSeam;
  report: UsageReport;
}

/** 模型 Token 占比切片：前三名 + “其他”。 */
export function modelSlices(report: UsageReport): Slice[] {
  const models = [...(report.models ?? [])].sort((a, b) => b.total_tokens - a.total_tokens);
  const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];
  const top = models.slice(0, 3).map((m, i) => ({
    label: modelName(m.model),
    value: m.total_tokens,
    color: colors[i],
  }));
  const rest = models.slice(3).reduce((n, m) => n + m.total_tokens, 0);
  return rest > 0 ? [...top, { label: "其他", value: rest, color: "var(--chart-4)" }] : top;
}

/** 用量概览：统计卡 + 使用趋势 + 模型分布 + 最近会话 / 用量明细。 */
export function UsageOverview({ cs, report }: UsageViewProps) {
  const [tab, setTab] = useState<"sessions" | "logs">("sessions");
  const sessions = useMemo(() => buildSessions(report.logs), [report.logs]);
  const days = useMemo(() => buildDays(report), [report]);
  const slices = useMemo(() => modelSlices(report), [report]);
  const tagged = sessions.filter((s) => !s.untagged);

  const spanMs = days.reduce((n, d) => n + d.spanMs, 0);
  const apiMs = report.logs.reduce((n, l) => n + (l.duration_ms ?? 0), 0);
  const tokens = report.stats.total_tokens ?? 0;
  const quota = cs.service?.quota;
  const quotaUsed = cs.service?.quota_used;
  const quotaPct = quota && quota > 0 && quotaUsed != null ? (quotaUsed / quota) * 100 : undefined;
  const tokensInLogs = tagged.reduce((n, s) => n + s.tokens, 0);

  const tabs = (
    <div className="tabs" role="tablist">
      <button role="tab" aria-selected={tab === "sessions"} className={tab === "sessions" ? "on" : ""} onClick={() => setTab("sessions")}>
        最近会话
      </button>
      <button role="tab" aria-selected={tab === "logs"} className={tab === "logs" ? "on" : ""} onClick={() => setTab("logs")}>
        用量明细
      </button>
    </div>
  );

  return (
    <>
      <div className="usage-stats">
        <UsageStat
          icon={<Clock size={18} />}
          label="本周期已用时长"
          value={report.logs.length ? duration(spanMs) : "0 分钟"}
          percent={spanMs > 0 ? Math.min(100, (apiMs / spanMs) * 100) : undefined}
          percentText={spanMs > 0 ? "响应占比" : undefined}
          sub={report.logs.length ? `其中模型响应 ${duration(apiMs)}` : "区间内没有请求记录"}
        />
        <UsageStat
          icon={<Layers size={18} />}
          label="本周期已用 Tokens"
          value={full(tokens)}
          percent={quotaPct}
          percentText={quotaPct != null ? `额度 ${quotaPct.toFixed(1)}%` : undefined}
          sub={
            report.stats.total_input_tokens != null
              ? `Input ${compact(report.stats.total_input_tokens)} · Output ${compact(report.stats.total_output_tokens ?? 0)} · Cache ${compact(report.stats.total_cache_tokens ?? 0)}`
              : undefined
          }
        />
        <UsageStat
          icon={<MessageSquare size={18} />}
          label="会话次数"
          value={tagged.length ? full(tagged.length) : "—"}
          sub={
            tagged.length
              ? `日均 ${(tagged.length / Math.max(days.length, 1)).toFixed(1)} 次`
              : report.logs.length
                ? "请求未携带会话标识"
                : "区间内没有请求记录"
          }
        />
        <UsageStat
          icon={<Hash size={18} />}
          label="平均每会话"
          value={tagged.length ? full(tokensInLogs / tagged.length) : "—"}
          sub="Tokens"
        />
      </div>

      <div className="usage-row">
        <Card title="使用趋势" subtitle="按日统计的 Tokens 与使用时长。">
          <TrendChart days={days} />
        </Card>
        <Card title="模型分布" subtitle="按 Token 用量占比。">
          {slices.length ? (
            <div className="donut-box">
              <Donut slices={slices} center={compact(tokens)} unit="Tokens" />
              <ul className="donut-legend">
                {slices.map((s) => (
                  <li key={s.label}>
                    <i style={{ background: s.color }} />
                    <span>{s.label}</span>
                    <strong>{pct(s.value, slices.reduce((n, x) => n + x.value, 0))}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="table-empty">区间内没有模型用量。</p>
          )}
        </Card>
      </div>

      <Card className="usage-table-card">
        {tab === "sessions" ? (
          <SessionTable logs={report.logs} lead={tabs} />
        ) : (
          <LogTable logs={report.logs} lead={tabs} />
        )}
      </Card>
    </>
  );
}

import { useMemo } from "react";
import { CalendarDays, Coins, Percent, Receipt } from "lucide-react";
import { buildDays, buildSessions, clock, compact, modelName, money, shortId } from "../../lib/usage";
import { Card } from "../../components/ui/Card";
import { BarList, DayBars } from "../../components/usage/Charts";
import { UsageStat } from "../../components/usage/UsageStat";
import type { UsageViewProps } from "./UsageOverview";

/** 成本统计：实际扣除、标准计费、每日成本、按模型与按会话的费用分布。 */
export function UsageCost({ report }: UsageViewProps) {
  const days = useMemo(() => buildDays(report), [report]);
  const sessions = useMemo(() => buildSessions(report.logs), [report.logs]);
  const actual = report.stats.total_actual_cost ?? 0;
  const standard = report.stats.total_cost ?? 0;
  const tokens = report.stats.total_tokens ?? 0;
  const models = [...(report.models ?? [])].sort((a, b) => b.actual_cost - a.actual_cost);
  const topSessions = [...sessions].sort((a, b) => b.cost - a.cost).filter((s) => s.cost > 0).slice(0, 5);

  return (
    <>
      <div className="usage-stats">
        <UsageStat icon={<Coins size={18} />} label="实际扣除额度" value={money(actual)} sub="服务端按倍率折算后的扣除额" />
        <UsageStat icon={<Receipt size={18} />} label="标准计费" value={money(standard)} sub="按模型标准价格计算的费用" />
        <UsageStat
          icon={<Percent size={18} />}
          label="计费倍率"
          value={standard > 0 ? `×${(actual / standard).toFixed(2)}` : "—"}
          sub="实际扣除 ÷ 标准计费"
        />
        <UsageStat
          icon={<CalendarDays size={18} />}
          label="日均扣除"
          value={money(actual / Math.max(days.length, 1))}
          sub={tokens > 0 ? `每百万 Tokens ${money((actual / tokens) * 1e6)}` : undefined}
        />
      </div>
      <Card title="每日成本" subtitle="区间内每天的实际扣除额度。">
        <DayBars days={days} pick={(d) => d.cost} format={(v) => `$${+v.toFixed(v >= 100 ? 0 : 2)}`} />
      </Card>
      <div className="usage-row usage-row--even">
        <Card title="按模型" subtitle="各模型实际扣除额度。">
          {models.length ? (
            <BarList
              rows={models.map((m) => ({
                label: modelName(m.model),
                value: m.actual_cost,
                text: money(m.actual_cost),
                sub: `${compact(m.total_tokens)} Tokens · ${m.requests.toLocaleString("zh-CN")} 次请求`,
              }))}
            />
          ) : (
            <p className="table-empty">暂无数据。</p>
          )}
        </Card>
        <Card title="成本最高的会话" subtitle={report.truncated ? "仅统计已拉取的最近记录。" : "按实际扣除额度排序的前 5 个会话。"}>
          {topSessions.length ? (
            <BarList
              rows={topSessions.map((s) => ({
                id: s.id,
                label: s.untagged ? "未标记会话" : `会话 ${shortId(s.id)}`,
                value: s.cost,
                text: money(s.cost),
                sub: `${clock(s.start)} · ${compact(s.tokens)} Tokens · ${s.requests} 次请求`,
              }))}
            />
          ) : (
            <p className="table-empty">暂无数据。</p>
          )}
        </Card>
      </div>
    </>
  );
}

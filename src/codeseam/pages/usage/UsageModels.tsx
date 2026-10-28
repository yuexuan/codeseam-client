import { useMemo } from "react";
import { Boxes, Cpu, Layers, Zap } from "lucide-react";
import { compact, full, modelName, money, pct } from "../../lib/usage";
import { Card } from "../../components/ui/Card";
import { Donut } from "../../components/usage/Charts";
import { UsageStat } from "../../components/usage/UsageStat";
import { modelSlices, type UsageViewProps } from "./UsageOverview";

/** 模型统计：各模型的请求数、Token 构成与费用。 */
export function UsageModels({ report }: UsageViewProps) {
  const models = useMemo(
    () => [...(report.models ?? [])].sort((a, b) => b.total_tokens - a.total_tokens),
    [report.models],
  );
  const slices = useMemo(() => modelSlices(report), [report]);
  const total = models.reduce((n, m) => n + m.total_tokens, 0);
  const totalReq = models.reduce((n, m) => n + m.requests, 0);
  const top = models[0];
  const cacheRead = models.reduce((n, m) => n + m.cache_read_tokens, 0);
  const inputSide = models.reduce((n, m) => n + m.input_tokens + m.cache_read_tokens + m.cache_creation_tokens, 0);

  return (
    <>
      <div className="usage-stats">
        <UsageStat icon={<Boxes size={18} />} label="使用模型数" value={full(models.length)} sub="区间内调用过的模型" />
        <UsageStat icon={<Cpu size={18} />} label="最常用模型" value={top ? modelName(top.model).replace(/^Claude /, "") : "—"} sub={top ? `占 Token 的 ${pct(top.total_tokens, total)}` : "区间内没有请求记录"} />
        <UsageStat icon={<Layers size={18} />} label="总请求数" value={full(totalReq)} sub={totalReq ? `平均每次 ${compact(total / totalReq)} Tokens` : undefined} />
        <UsageStat
          icon={<Zap size={18} />}
          label="缓存命中占比"
          value={inputSide ? pct(cacheRead, inputSide) : "—"}
          percent={inputSide ? (cacheRead / inputSide) * 100 : undefined}
          percentText="Cache 读取"
          sub="Cache 读取 ÷ 全部输入侧 Token"
        />
      </div>
      <div className="usage-row usage-row--models">
        <Card title="模型明细" subtitle="按 Token 用量从高到低排序；费用为服务端计费结果。">
          <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>模型</th>
                <th className="num">请求</th>
                <th className="num">Input</th>
                <th className="num">Output</th>
                <th className="num">Cache</th>
                <th className="num">Tokens</th>
                <th className="num">占比</th>
                <th className="num">标准费用</th>
                <th className="num">实际扣除</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.model}>
                  <td title={m.model}>
                    <strong>{modelName(m.model)}</strong>
                  </td>
                  <td className="num">{full(m.requests)}</td>
                  <td className="num">{full(m.input_tokens)}</td>
                  <td className="num">{full(m.output_tokens)}</td>
                  <td className="num">{full(m.cache_creation_tokens + m.cache_read_tokens)}</td>
                  <td className="num">{full(m.total_tokens)}</td>
                  <td className="num">{pct(m.total_tokens, total)}</td>
                  <td className="num">{money(m.cost)}</td>
                  <td className="num">{money(m.actual_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {models.length === 0 && <p className="table-empty">区间内没有模型用量。</p>}
        </Card>
        <Card title="Token 占比" subtitle="前三名模型与其他。">
          {slices.length ? (
            <div className="donut-box donut-box--stack">
              <Donut slices={slices} center={compact(total)} unit="Tokens" />
              <ul className="donut-legend">
                {slices.map((s) => (
                  <li key={s.label}>
                    <i style={{ background: s.color }} />
                    <span>{s.label}</span>
                    <strong>{pct(s.value, total)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="table-empty">暂无数据。</p>
          )}
        </Card>
      </div>
    </>
  );
}

import { useState } from "react";
import type { DayPoint } from "../../lib/usage";
import { compact, duration, full, money } from "../../lib/usage";

/** 取不小于 v 的“整齐”刻度上限，并均分为 n 段。 */
function niceScale(v: number, n = 4): { max: number; step: number } {
  if (v <= 0) return { max: n, step: 1 };
  const raw = v / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  return { max: step * n, step };
}

const W = 620;
const H = 220;
const PAD = { l: 52, r: 46, t: 14, b: 28 };

/**
 * 使用趋势：折线为每日 Tokens（左轴），柱为每日使用时长（右轴，小时）。
 * 数据全部来自服务端计量，无数据的日子补 0。
 */
export function TrendChart({ days }: { days: DayPoint[] }) {
  const [hover, setHover] = useState<number>();
  const tokScale = niceScale(Math.max(...days.map((d) => d.tokens), 0));
  const hours = days.map((d) => d.spanMs / 3600000);
  const hrScale = niceScale(Math.max(...hours, 0));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const slot = iw / Math.max(days.length, 1);
  const cx = (i: number) => PAD.l + slot * (i + 0.5);
  const yTok = (v: number) => PAD.t + ih - (v / tokScale.max) * ih;
  const yHr = (v: number) => PAD.t + ih - (v / hrScale.max) * ih;
  const barW = Math.min(26, slot * 0.5);
  const every = Math.ceil(days.length / 9);
  const line = days.map((d, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)},${yTok(d.tokens).toFixed(1)}`).join(" ");
  const area = days.length
    ? `${line} L${cx(days.length - 1).toFixed(1)},${PAD.t + ih} L${cx(0).toFixed(1)},${PAD.t + ih} Z`
    : "";
  const ticks = [0, 1, 2, 3, 4];
  const h = hover != null ? days[hover] : undefined;

  return (
    <div className="chart-wrap">
      <div className="chart-legend">
        <span>
          <i className="lg lg--line" />
          Tokens
        </span>
        <span>
          <i className="lg lg--bar" />
          使用时长
        </span>
      </div>
      <svg
        className="trend-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="每日 Tokens 与使用时长趋势"
        onMouseLeave={() => setHover(undefined)}
      >
        {ticks.map((t) => {
          const y = PAD.t + ih - (t / 4) * ih;
          return (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} className="chart-grid" />
              <text x={PAD.l - 8} y={y + 4} textAnchor="end" className="chart-axis">
                {compact(tokScale.step * t)}
              </text>
              <text x={W - PAD.r + 8} y={y + 4} className="chart-axis">
                {+(hrScale.step * t).toFixed(2)}
              </text>
            </g>
          );
        })}
        <text x={W - PAD.r + 8} y={PAD.t - 4} className="chart-axis chart-axis--unit">
          小时
        </text>
        {hours.map((hr, i) => (
          <rect
            key={days[i].date}
            x={cx(i) - barW / 2}
            y={yHr(hr)}
            width={barW}
            height={PAD.t + ih - yHr(hr)}
            rx={3}
            className={`chart-bar${hover === i ? " chart-bar--on" : ""}`}
          />
        ))}
        {area && <path d={area} className="chart-area" />}
        <path d={line} className="chart-line" />
        {days.map((d, i) => (
          <circle
            key={d.date}
            cx={cx(i)}
            cy={yTok(d.tokens)}
            r={hover === i ? 4.5 : 3}
            className="chart-dot"
          />
        ))}
        {days.map((d, i) =>
          i % every === 0 ? (
            <text key={d.date} x={cx(i)} y={H - 8} textAnchor="middle" className="chart-axis">
              {d.date.slice(5)}
            </text>
          ) : null,
        )}
        {days.map((d, i) => (
          <rect
            key={`h-${d.date}`}
            x={PAD.l + slot * i}
            y={PAD.t}
            width={slot}
            height={ih}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      {h && hover != null && (
        <div
          className="chart-tip"
          style={{ left: `${(cx(hover) / W) * 100}%` }}
          role="status"
        >
          <strong>{h.date}</strong>
          <span>Tokens {full(h.tokens)}</span>
          <span>使用时长 {h.spanMs ? duration(h.spanMs) : "0 分钟"}</span>
          <span>请求 {full(h.requests)} · {money(h.cost)}</span>
        </div>
      )}
    </div>
  );
}

export interface Slice {
  label: string;
  value: number;
  color: string;
}

/** 环形图：中心显示合计。 */
export function Donut({ slices, center, unit }: { slices: Slice[]; center: string; unit: string }) {
  const total = slices.reduce((n, s) => n + s.value, 0);
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg className="donut" viewBox="0 0 140 140" role="img" aria-label="模型 Token 占比">
      <circle cx="70" cy="70" r={r} className="donut-track" />
      {total > 0 &&
        slices.map((s) => {
          const len = (s.value / total) * c;
          const el = (
            <circle
              key={s.label}
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth="16"
              strokeDasharray={`${Math.max(len - 1.5, 0)} ${c - Math.max(len - 1.5, 0)}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
            />
          );
          offset += len;
          return el;
        })}
      <text x="70" y="68" textAnchor="middle" className="donut-value">
        {center}
      </text>
      <text x="70" y="86" textAnchor="middle" className="donut-unit">
        {unit}
      </text>
    </svg>
  );
}

/** 横向占比条列表：模型 / 费用占比。 */
export function BarList({
  rows,
}: {
  rows: { id?: string; label: string; value: number; text: string; sub?: string }[];
}) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <ul className="barlist">
      {rows.map((r) => (
        <li key={r.id ?? r.label}>
          <div className="barlist-head">
            <span>{r.label}</span>
            <strong>{r.text}</strong>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${max > 0 ? (r.value / max) * 100 : 0}%` }} />
          </div>
          {r.sub && <small>{r.sub}</small>}
        </li>
      ))}
    </ul>
  );
}

/** 每日柱状图（成本趋势等单序列）。 */
export function DayBars({
  days,
  pick,
  format,
}: {
  days: DayPoint[];
  pick: (d: DayPoint) => number;
  format: (v: number) => string;
}) {
  const [hover, setHover] = useState<number>();
  const values = days.map(pick);
  const scale = niceScale(Math.max(...values, 0));
  const iw = W - PAD.l - 16;
  const ih = H - PAD.t - PAD.b;
  const slot = iw / Math.max(days.length, 1);
  const barW = Math.min(28, slot * 0.55);
  const every = Math.ceil(days.length / 9);
  return (
    <div className="chart-wrap">
      <svg className="trend-chart" viewBox={`0 0 ${W} ${H}`} role="img" onMouseLeave={() => setHover(undefined)}>
        {[0, 1, 2, 3, 4].map((t) => {
          const y = PAD.t + ih - (t / 4) * ih;
          return (
            <g key={t}>
              <line x1={PAD.l} x2={W - 16} y1={y} y2={y} className="chart-grid" />
              <text x={PAD.l - 8} y={y + 4} textAnchor="end" className="chart-axis">
                {format(scale.step * t)}
              </text>
            </g>
          );
        })}
        {values.map((v, i) => {
          const hgt = (v / scale.max) * ih;
          const x = PAD.l + slot * (i + 0.5);
          return (
            <g key={days[i].date}>
              <rect
                x={x - barW / 2}
                y={PAD.t + ih - hgt}
                width={barW}
                height={hgt}
                rx={3}
                className={`chart-bar chart-bar--solid${hover === i ? " chart-bar--on" : ""}`}
              />
              {i % every === 0 && (
                <text x={x} y={H - 8} textAnchor="middle" className="chart-axis">
                  {days[i].date.slice(5)}
                </text>
              )}
              <rect
                x={PAD.l + slot * i}
                y={PAD.t}
                width={slot}
                height={ih}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div
          className="chart-tip"
          style={{ left: `${((PAD.l + slot * (hover + 0.5)) / W) * 100}%` }}
          role="status"
        >
          <strong>{days[hover].date}</strong>
          <span>{format(values[hover])}</span>
        </div>
      )}
    </div>
  );
}

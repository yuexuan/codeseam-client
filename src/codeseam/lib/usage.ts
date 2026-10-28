/** 用量页的数据整理：把请求明细归并为会话/每日统计，并提供格式化与导出。 */

import type { UsageLog, UsageReport, UsageTrendPoint } from "./types";

/** 相邻请求间隔超过该值视为不同使用时段，间隔不计入使用时长。 */
const IDLE_GAP_MS = 30 * 60 * 1000;
/** 最近请求在该时间内视为会话仍在进行。 */
const ACTIVE_MS = 5 * 60 * 1000;

export interface Session {
  /** 会话 id；服务端未提供 session_id 的请求聚合为一个“未标记会话”。 */
  id: string;
  untagged: boolean;
  start: number;
  end: number;
  requests: number;
  models: string[];
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cost: number;
  /** 使用时长（毫秒）：相邻请求间隔不超过 30 分钟的区间合并后累加。 */
  spanMs: number;
  /** 模型响应耗时（毫秒）：各请求 duration_ms 之和。 */
  apiMs: number;
  active: boolean;
  logs: UsageLog[];
}

export interface DayPoint {
  date: string;
  tokens: number;
  requests: number;
  cost: number;
  standardCost: number;
  /** 当天使用时长（毫秒），由请求明细按本地日期汇总。 */
  spanMs: number;
}

const two = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const ts = (l: UsageLog) => new Date(l.created_at).getTime();

export const cacheTokens = (l: UsageLog) => l.cache_creation_tokens + l.cache_read_tokens;
export const logTokens = (l: UsageLog) => l.input_tokens + l.output_tokens + cacheTokens(l);

/** 请求区间：终点为 created_at，起点为终点往前推耗时。 */
const interval = (l: UsageLog): [number, number] => {
  const end = ts(l);
  return [end - (l.duration_ms ?? 0), end];
};

/** 区间按起点排序后，间隔不超过 IDLE_GAP_MS 的合并，求总长。 */
function activeSpan(logs: UsageLog[]): number {
  const iv = logs.map(interval).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | undefined;
  for (const [s, e] of iv) {
    if (cur && s - cur[1] <= IDLE_GAP_MS) {
      cur[1] = Math.max(cur[1], e);
    } else {
      if (cur) total += cur[1] - cur[0];
      cur = [s, e];
    }
  }
  if (cur) total += cur[1] - cur[0];
  return total;
}

const sum = (list: UsageLog[], f: (l: UsageLog) => number) => list.reduce((n, l) => n + f(l), 0);

export function buildSessions(logs: UsageLog[], now = Date.now()): Session[] {
  const map = new Map<string, UsageLog[]>();
  for (const l of logs) {
    const key = l.session_id || "";
    const list = map.get(key);
    if (list) list.push(l);
    else map.set(key, [l]);
  }
  const out: Session[] = [];
  for (const [id, list] of map) {
    list.sort((a, b) => ts(a) - ts(b));
    const end = ts(list[list.length - 1]);
    out.push({
      id: id || "untagged",
      untagged: !id,
      start: interval(list[0])[0],
      end,
      requests: list.length,
      models: [...new Set(list.map((l) => l.model))],
      tokens: sum(list, logTokens),
      inputTokens: sum(list, (l) => l.input_tokens),
      outputTokens: sum(list, (l) => l.output_tokens),
      cacheTokens: sum(list, cacheTokens),
      cost: sum(list, (l) => l.actual_cost),
      spanMs: activeSpan(list),
      apiMs: sum(list, (l) => l.duration_ms ?? 0),
      active: now - end <= ACTIVE_MS,
      logs: list,
    });
  }
  return out.sort((a, b) => b.end - a.end);
}

/** 区间内逐日（本地日期）补零的序列。 */
export function buildDays(r: UsageReport): DayPoint[] {
  const trend = new Map<string, UsageTrendPoint>();
  for (const t of r.trend ?? []) trend.set(t.date.slice(0, 10), t);
  const byDay = new Map<string, UsageLog[]>();
  for (const l of r.logs) {
    const k = ymd(new Date(l.created_at));
    const list = byDay.get(k);
    if (list) list.push(l);
    else byDay.set(k, [l]);
  }
  const out: DayPoint[] = [];
  const end = new Date(`${r.end}T00:00:00`);
  for (let d = new Date(`${r.start}T00:00:00`); d <= end; d.setDate(d.getDate() + 1)) {
    const k = ymd(d);
    const t = trend.get(k);
    out.push({
      date: k,
      tokens: t?.total_tokens ?? 0,
      requests: t?.requests ?? 0,
      cost: t?.actual_cost ?? 0,
      standardCost: t?.cost ?? 0,
      spanMs: activeSpan(byDay.get(k) ?? []),
    });
  }
  return out;
}

/** 模型友好名：claude-sonnet-4-20250514 → Claude Sonnet 4。 */
export function modelName(id: string): string {
  const m = id.match(/^claude-(?:(\d+(?:[.-]\d+)?)-)?(opus|sonnet|haiku)(?:-(\d+(?:[.-]\d)?)(?!\d))?/i);
  if (!m) return id;
  const family = m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
  const ver = (m[1] || m[3] || "").replace("-", ".");
  return `Claude ${family}${ver ? ` ${ver}` : ""}`;
}

/** 1280450 → 1.28M；12800 → 12.8K。 */
export function compact(n: number): string {
  const a = Math.abs(n);
  const f = (v: number, d: number, u: string) => `${v.toFixed(d).replace(/\.?0+$/, "")}${u}`;
  if (a >= 1e9) return f(n / 1e9, 2, "B");
  if (a >= 1e6) return f(n / 1e6, 2, "M");
  if (a >= 1e4) return f(n / 1e3, 1, "K");
  return Math.round(n).toLocaleString("zh-CN");
}

export const full = (n: number) => Math.round(n).toLocaleString("zh-CN");

/** 毫秒 → “2 时 18 分” / “28 分钟” / “45 秒”。 */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟`;
  return `${Math.floor(m / 60)} 时 ${m % 60} 分`;
}

export const money = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

export const pct = (part: number, total: number) =>
  total > 0 ? `${((part / total) * 100).toFixed(1)}%` : "0.0%";

export const clock = (ms: number) => {
  const d = new Date(ms);
  return `${ymd(d)} ${two(d.getHours())}:${two(d.getMinutes())}`;
};

export const shortId = (id: string) => (id.length > 8 ? id.slice(0, 8) : id);

/** 区间预设：含今天的最近 n 天。 */
export function lastDays(n: number): [string, string] {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (n - 1));
  return [ymd(start), ymd(end)];
}

// ---------- 导出 ----------

const csvCell = (v: unknown) => {
  let s = v == null ? "" : String(v);
  // 避免在表格软件中被当作公式执行。
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (header: string[], rows: unknown[][]) =>
  "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");

export type ExportKind = "sessions" | "logs" | "models" | "daily";

export const exportKinds: { id: ExportKind; label: string; hint: string }[] = [
  { id: "sessions", label: "会话汇总", hint: "每个会话一行：时间、模型、请求数、Token、时长、费用" },
  { id: "logs", label: "请求明细", hint: "每次请求一行：时间、模型、各类 Token、耗时、费用" },
  { id: "models", label: "模型统计", hint: "按模型汇总的请求数、Token 与费用" },
  { id: "daily", label: "每日趋势", hint: "区间内逐日的请求、Token、费用与使用时长" },
];

export function exportRows(kind: ExportKind, r: UsageReport): { header: string[]; rows: unknown[][] } {
  if (kind === "sessions") {
    return {
      header: ["会话", "开始时间", "最近活动", "模型", "请求数", "Tokens", "Input", "Output", "Cache", "使用时长(分钟)", "实际扣除"],
      rows: buildSessions(r.logs).map((s) => [
        s.untagged ? "未标记会话" : s.id,
        clock(s.start),
        clock(s.end),
        s.models.map(modelName).join(" / "),
        s.requests,
        s.tokens,
        s.inputTokens,
        s.outputTokens,
        s.cacheTokens,
        Math.round(s.spanMs / 60000),
        s.cost,
      ]),
    };
  }
  if (kind === "logs") {
    return {
      header: ["时间", "会话", "请求 ID", "模型", "Input", "Output", "Cache 写入", "Cache 读取", "耗时(ms)", "首字(ms)", "标准费用", "实际扣除"],
      rows: r.logs.map((l) => [
        clock(ts(l)),
        l.session_id ?? "",
        l.request_id,
        l.model,
        l.input_tokens,
        l.output_tokens,
        l.cache_creation_tokens,
        l.cache_read_tokens,
        l.duration_ms ?? "",
        l.first_token_ms ?? "",
        l.total_cost,
        l.actual_cost,
      ]),
    };
  }
  if (kind === "models") {
    return {
      header: ["模型", "请求数", "Tokens", "Input", "Output", "Cache 写入", "Cache 读取", "标准费用", "实际扣除"],
      rows: (r.models ?? []).map((m) => [
        m.model, m.requests, m.total_tokens, m.input_tokens, m.output_tokens,
        m.cache_creation_tokens, m.cache_read_tokens, m.cost, m.actual_cost,
      ]),
    };
  }
  return {
    header: ["日期", "请求数", "Tokens", "标准费用", "实际扣除", "使用时长(分钟)"],
    rows: buildDays(r).map((d) => [d.date, d.requests, d.tokens, d.standardCost, d.cost, Math.round(d.spanMs / 60000)]),
  };
}

/** 触发 WebView 下载。 */
export function download(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { UsageLog } from "../../lib/types";
import {
  buildSessions,
  clock,
  duration,
  full,
  logTokens,
  modelName,
  money,
  shortId,
  type Session,
} from "../../lib/usage";
import { Badge } from "../ui/Badge";

/** 表格分页条。 */
function Pager({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  return (
    <div className="pager">
      <small>共 {full(total)} 条</small>
      <div className="pager-ctl">
        <button className="icon-btn" disabled={page <= 1} aria-label="上一页" onClick={() => onPage(page - 1)}>
          <ChevronLeft size={14} />
        </button>
        <span>
          {page} / {pages}
        </span>
        <button className="icon-btn" disabled={page >= pages} aria-label="下一页" onClick={() => onPage(page + 1)}>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

function usePaged<T>(rows: T[], size: number) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const cur = Math.min(page, pages);
  return { rows: rows.slice((cur - 1) * size, cur * size), page: cur, pages, setPage };
}

function ModelSelect({
  models,
  value,
  onChange,
}: {
  models: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select className="filter-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label="按模型筛选">
      <option value="">全部模型</option>
      {models.map((m) => (
        <option key={m} value={m}>
          {modelName(m)}
        </option>
      ))}
    </select>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="filter-search">
      <Search size={13} />
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

const modelLabel = (models: string[]) =>
  models.length === 0 ? "—" : modelName(models[0]) + (models.length > 1 ? ` +${models.length - 1}` : "");

/** 一次会话内的请求明细（行内展开）。 */
function SessionDetail({ session }: { session: Session }) {
  return (
    <div className="session-detail">
      <div className="session-detail-meta">
        <span>
          Input <strong>{full(session.inputTokens)}</strong>
        </span>
        <span>
          Output <strong>{full(session.outputTokens)}</strong>
        </span>
        <span>
          Cache <strong>{full(session.cacheTokens)}</strong>
        </span>
        <span>
          模型响应耗时 <strong>{duration(session.apiMs)}</strong>
        </span>
        <span>
          实际扣除 <strong>{money(session.cost)}</strong>
        </span>
      </div>
      <LogRows logs={[...session.logs].reverse().slice(0, 50)} />
      {session.logs.length > 50 && <small>仅显示最近 50 次请求，完整记录请在“导出报表”导出。</small>}
    </div>
  );
}

function LogRows({ logs }: { logs: UsageLog[] }) {
  return (
    <table className="data-table data-table--inner">
      <thead>
        <tr>
          <th>时间</th>
          <th>模型</th>
          <th className="num">Input</th>
          <th className="num">Output</th>
          <th className="num">Cache</th>
          <th className="num">耗时</th>
          <th className="num">实际扣除</th>
        </tr>
      </thead>
      <tbody>
        {logs.map((l) => (
          <tr key={l.id}>
            <td>{clock(new Date(l.created_at).getTime())}</td>
            <td>{modelName(l.model)}</td>
            <td className="num">{full(l.input_tokens)}</td>
            <td className="num">{full(l.output_tokens)}</td>
            <td className="num">{full(l.cache_creation_tokens + l.cache_read_tokens)}</td>
            <td className="num">{l.duration_ms != null ? `${(l.duration_ms / 1000).toFixed(1)} 秒` : "—"}</td>
            <td className="num">{money(l.actual_cost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 会话表：筛选 + 分页 + 行内展开请求明细。 */
export function SessionTable({ logs, pageSize = 8, lead }: { logs: UsageLog[]; pageSize?: number; lead?: ReactNode }) {
  const sessions = useMemo(() => buildSessions(logs), [logs]);
  const models = useMemo(() => [...new Set(logs.map((l) => l.model))].sort(), [logs]);
  const [model, setModel] = useState("");
  const [state, setState] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string>();
  const filtered = sessions.filter(
    (s) =>
      (!model || s.models.includes(model)) &&
      (!state || (state === "active") === s.active) &&
      (!q || s.id.toLowerCase().includes(q.trim().toLowerCase())),
  );
  const paged = usePaged(filtered, pageSize);
  return (
    <>
      <div className="table-bar">
        {lead}
        <div className="table-filters">
        <ModelSelect models={models} value={model} onChange={setModel} />
        <select className="filter-select" value={state} onChange={(e) => setState(e.target.value)} aria-label="按状态筛选">
          <option value="">全部状态</option>
          <option value="active">进行中</option>
          <option value="done">已结束</option>
        </select>
        <SearchBox value={q} onChange={setQ} placeholder="搜索会话 ID" />
        </div>
      </div>
      <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>开始时间</th>
            <th>会话</th>
            <th>模型</th>
            <th className="num">请求</th>
            <th className="num">Tokens</th>
            <th className="num">时长</th>
            <th>状态</th>
            <th className="act">操作</th>
          </tr>
        </thead>
        <tbody>
          {paged.rows.map((s) => (
            <SessionRow key={s.id} s={s} open={open === s.id} onToggle={() => setOpen(open === s.id ? undefined : s.id)} />
          ))}
        </tbody>
      </table>
      </div>
      {filtered.length === 0 && <p className="table-empty">没有符合条件的会话。</p>}
      <Pager page={paged.page} pages={paged.pages} total={filtered.length} onPage={paged.setPage} />
    </>
  );
}

function SessionRow({ s, open, onToggle }: { s: Session; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className={open ? "is-open" : ""}>
        <td>{clock(s.start)}</td>
        <td title={s.untagged ? "这些请求未携带会话标识，按一个条目汇总" : s.id}>
          <strong className="mono-id">{s.untagged ? "未标记会话" : shortId(s.id)}</strong>
        </td>
        <td>{modelLabel(s.models)}</td>
        <td className="num">{full(s.requests)}</td>
        <td className="num">{full(s.tokens)}</td>
        <td className="num">{duration(s.spanMs)}</td>
        <td>
          <Badge tone={s.active ? "green" : "neutral"}>{s.active ? "进行中" : "已结束"}</Badge>
        </td>
        <td className="act">
          <button className="link" onClick={onToggle} aria-expanded={open}>
            {open ? "收起" : "详情"}
            <ChevronDown size={13} className={open ? "flip" : ""} />
          </button>
        </td>
      </tr>
      {open && (
        <tr className="detail-row">
          <td colSpan={8}>
            <SessionDetail session={s} />
          </td>
        </tr>
      )}
    </>
  );
}

/** 请求明细表：按模型筛选、搜索请求/会话 ID、分页。 */
export function LogTable({ logs, pageSize = 8, lead }: { logs: UsageLog[]; pageSize?: number; lead?: ReactNode }) {
  const models = useMemo(() => [...new Set(logs.map((l) => l.model))].sort(), [logs]);
  const [model, setModel] = useState("");
  const [q, setQ] = useState("");
  const sorted = useMemo(
    () => [...logs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [logs],
  );
  const needle = q.trim().toLowerCase();
  const filtered = sorted.filter(
    (l) =>
      (!model || l.model === model) &&
      (!needle ||
        l.request_id.toLowerCase().includes(needle) ||
        (l.session_id ?? "").toLowerCase().includes(needle)),
  );
  const paged = usePaged(filtered, pageSize);
  return (
    <>
      <div className="table-bar">
        {lead}
        <div className="table-filters">
          <ModelSelect models={models} value={model} onChange={setModel} />
          <SearchBox value={q} onChange={setQ} placeholder="搜索请求 / 会话 ID" />
        </div>
      </div>
      <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>会话</th>
            <th>模型</th>
            <th className="num">Input</th>
            <th className="num">Output</th>
            <th className="num">Cache</th>
            <th className="num">Tokens</th>
            <th className="num">耗时</th>
            <th className="num">实际扣除</th>
          </tr>
        </thead>
        <tbody>
          {paged.rows.map((l) => (
            <tr key={l.id}>
              <td>{clock(new Date(l.created_at).getTime())}</td>
              <td>
                <span className="mono-id">{l.session_id ? shortId(l.session_id) : "—"}</span>
              </td>
              <td>{modelName(l.model)}</td>
              <td className="num">{full(l.input_tokens)}</td>
              <td className="num">{full(l.output_tokens)}</td>
              <td className="num">{full(l.cache_creation_tokens + l.cache_read_tokens)}</td>
              <td className="num">{full(logTokens(l))}</td>
              <td className="num">{l.duration_ms != null ? `${(l.duration_ms / 1000).toFixed(1)} 秒` : "—"}</td>
              <td className="num">{money(l.actual_cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {filtered.length === 0 && <p className="table-empty">没有符合条件的请求记录。</p>}
      <Pager page={paged.page} pages={paged.pages} total={filtered.length} onPage={paged.setPage} />
    </>
  );
}

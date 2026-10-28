import { useEffect, useState, type ReactElement } from "react";
import {
  Activity,
  Boxes,
  Coins,
  FileDown,
  Gauge,
  MessageSquare,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import type { CodeSeam } from "../lib/useCodeSeam";
import type { UsageTab } from "../lib/types";
import { full } from "../lib/usage";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { DateRange } from "../components/usage/DateRange";
import { UsageOverview } from "./usage/UsageOverview";
import { UsageSessions } from "./usage/UsageSessions";
import { UsageModels } from "./usage/UsageModels";
import { UsageCost } from "./usage/UsageCost";
import { UsageQuota } from "./usage/UsageQuota";
import { UsageExport } from "./usage/UsageExport";

const TABS: { id: UsageTab; label: string; title: string; subtitle: string; icon: ReactElement }[] = [
  { id: "overview", label: "用量概览", title: "用量概览", subtitle: "查看 Claude Code 的使用情况、会话统计和配额进度。", icon: <Activity size={16} /> },
  { id: "sessions", label: "会话记录", title: "会话记录", subtitle: "按会话查看请求数、Token 与使用时长。", icon: <MessageSquare size={16} /> },
  { id: "models", label: "模型统计", title: "模型统计", subtitle: "各模型的请求、Token 构成与费用。", icon: <Boxes size={16} /> },
  { id: "cost", label: "成本统计", title: "成本统计", subtitle: "实际扣除额度、标准计费与成本分布。", icon: <Coins size={16} /> },
  { id: "quota", label: "配额管理", title: "配额管理", subtitle: "服务有效期、平台额度与数据口径。", icon: <Gauge size={16} /> },
  { id: "export", label: "导出报表", title: "导出报表", subtitle: "把所选区间的用量导出为 CSV / JSON。", icon: <FileDown size={16} /> },
];

/** 用量管理：左侧二级导航 + 右侧内容；数据全部来自服务端真实计量。 */
export function UsagePage({ cs }: { cs: CodeSeam }) {
  const { status, usageReport: report, usageRange, usageLoading, usageError } = cs;
  const [tab, setTab] = useState<UsageTab>("overview");
  const loggedIn = !!status?.logged_in;
  const cur = TABS.find((t) => t.id === tab) ?? TABS[0];

  // 登录后首次进入（或退出再登录后）自动按当前区间取数。
  useEffect(() => {
    if (loggedIn && !report && !usageLoading && !usageError) {
      void cs.loadUsageReport(usageRange[0], usageRange[1]);
    }
  }, [loggedIn, report, usageLoading, usageError]);

  const reload = () => void cs.loadUsageReport(usageRange[0], usageRange[1]);

  let body;
  if (tab === "quota" && loggedIn) {
    body = <UsageQuota cs={cs} report={report} />;
  } else if (!loggedIn) {
    body = (
      <Card>
        <p className="table-empty">请先登录 CodeSeam 账号，再查看用量。</p>
      </Card>
    );
  } else if (usageError) {
    body = (
      <div className="error" role="alert">
        用量数据读取失败：{usageError}
        <div className="actions">
          <Button size="sm" onClick={reload}>
            重试
          </Button>
        </div>
      </div>
    );
  } else if (!report) {
    body = (
      <Card>
        <p className="table-empty">正在读取用量数据…</p>
      </Card>
    );
  } else {
    body = (
      <>
        {report.truncated && tab !== "models" && tab !== "export" && (
          <div className="usage-warn" role="status">
            <TriangleAlert size={14} />
            区间内共有 {full(report.logs_total)} 条请求，会话与明细仅覆盖最近 {full(report.logs.length)} 条；汇总数字不受影响。缩小日期区间可查看完整记录。
          </div>
        )}
        {tab === "overview" && <UsageOverview cs={cs} report={report} />}
        {tab === "sessions" && <UsageSessions cs={cs} report={report} />}
        {tab === "models" && <UsageModels cs={cs} report={report} />}
        {tab === "cost" && <UsageCost cs={cs} report={report} />}
        {tab === "export" && <UsageExport cs={cs} report={report} />}
      </>
    );
  }

  return (
    <div className="sub-layout">
      <aside className="sub-nav" aria-label="用量管理">
        <h2>用量管理</h2>
        <nav>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`subnav-btn${tab === t.id ? " selected" : ""}`}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
      </aside>
      <section className="sub-main">
        <div className="page-header">
          <div>
            <h1>{cur.title}</h1>
            <p>{cur.subtitle}</p>
          </div>
          <div className="actions">
            <DateRange
              value={usageRange}
              disabled={!loggedIn || usageLoading}
              onChange={(s, e) => void cs.loadUsageReport(s, e)}
            />
            <button
              className="icon-btn"
              aria-label="刷新用量"
              title="刷新用量"
              disabled={!loggedIn || usageLoading}
              onClick={reload}
            >
              <RefreshCw size={14} className={usageLoading ? "spin" : ""} />
            </button>
          </div>
        </div>
        {body}
      </section>
    </div>
  );
}

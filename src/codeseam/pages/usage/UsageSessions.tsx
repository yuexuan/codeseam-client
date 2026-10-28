import { useMemo } from "react";
import { CircleCheck, Clock, MessageSquare, Rows3 } from "lucide-react";
import { buildSessions, duration, full } from "../../lib/usage";
import { Card } from "../../components/ui/Card";
import { SessionTable } from "../../components/usage/Tables";
import { UsageStat } from "../../components/usage/UsageStat";
import type { UsageViewProps } from "./UsageOverview";

/** 会话记录：按 session_id 归并的会话列表，可展开查看每次请求。 */
export function UsageSessions({ report }: UsageViewProps) {
  const sessions = useMemo(() => buildSessions(report.logs), [report.logs]);
  const tagged = sessions.filter((s) => !s.untagged);
  const active = sessions.filter((s) => s.active).length;
  const avgMs = tagged.length ? tagged.reduce((n, s) => n + s.spanMs, 0) / tagged.length : 0;
  const untagged = sessions.find((s) => s.untagged);
  return (
    <>
      <div className="usage-stats">
        <UsageStat icon={<MessageSquare size={18} />} label="会话总数" value={tagged.length ? full(tagged.length) : "—"} sub="区间内出现过请求的会话" />
        <UsageStat icon={<CircleCheck size={18} />} label="进行中" value={full(active)} sub="最近 5 分钟内仍有请求" />
        <UsageStat icon={<Clock size={18} />} label="平均会话时长" value={tagged.length ? duration(avgMs) : "—"} sub="相邻请求间隔超过 30 分钟不计入" />
        <UsageStat icon={<Rows3 size={18} />} label="请求总数" value={full(report.stats.total_requests ?? report.logs.length)} sub={untagged ? `其中 ${full(untagged.requests)} 次未携带会话标识` : "全部请求均已归入会话"} />
      </div>
      <Card title="会话记录" subtitle="会话 ID 来自 Claude Code 请求；点击“详情”查看该会话的每次请求。">
        <SessionTable logs={report.logs} pageSize={12} />
      </Card>
    </>
  );
}

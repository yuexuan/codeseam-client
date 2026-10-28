import { useState } from "react";
import { Download, Trash2 } from "lucide-react";
import type { CodeSeam } from "../../lib/useCodeSeam";
import type { ActivityEvent } from "../../lib/types";
import { activityTime, fullTime } from "../../lib/format";
import { download } from "../../lib/usage";
import { Button } from "../../components/ui/Button";
import { SettingGroup } from "../../components/ui/SettingRow";

type Filter = "all" | ActivityEvent["kind"];

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "connect", label: "连接" },
  { id: "check", label: "检测" },
  { id: "config", label: "配置" },
  { id: "info", label: "信息" },
  { id: "warn", label: "警告" },
];
const KIND_TEXT: Record<ActivityEvent["kind"], string> = {
  connect: "连接",
  check: "检测",
  config: "配置",
  info: "信息",
  warn: "警告",
};

/** 日志与记录：客户端活动记录（本机保存，不含密钥）；可筛选、导出、清空，并导出最近一次诊断报告。 */
export function LogSettings({ cs }: { cs: CodeSeam }) {
  const { activity, report } = cs;
  const [filter, setFilter] = useState<Filter>("all");
  const rows = activity.filter((e) => filter === "all" || e.kind === filter);

  const exportText = () => {
    const lines = activity.map(
      (e) => `${fullTime(e.ts)}\t[${KIND_TEXT[e.kind]}]\t${e.title}${e.detail ? `\t${e.detail}` : ""}`,
    );
    download(`codeseam-activity-${Date.now()}.txt`, lines.join("\n"), "text/plain;charset=utf-8");
  };
  const exportReport = () => {
    if (!report) return;
    download(
      `codeseam-diagnostics-${report.generatedAt ?? Math.floor(Date.now() / 1000)}.json`,
      JSON.stringify(report, null, 2),
      "application/json",
    );
  };

  return (
    <>
      <SettingGroup
        title="活动记录"
        subtitle="记录连接、检测、配置等客户端事件，仅保存在本机，最多保留最近 200 条，不含任何密钥或令牌。"
      >
        <div className="filter-chips" role="group" aria-label="记录类型">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={`chip${filter === f.id ? " selected" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {rows.length > 0 ? (
          <ul className="set-list">
            {rows.map((e) => (
              <li key={`${e.ts}-${e.title}`}>
                <span className="when">{activityTime(e.ts)}</span>
                <span className="what">
                  {e.title}
                  {e.detail && <small>{e.detail}</small>}
                </span>
                <span className={`log-kind log-kind--${e.kind}`}>{KIND_TEXT[e.kind]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="set-empty">{activity.length ? "该类型暂无记录。" : "还没有活动记录。"}</p>
        )}
        <div className="set-actions">
          <Button icon={<Download size={14} />} disabled={!activity.length} onClick={exportText}>
            导出记录
          </Button>
          <Button icon={<Trash2 size={14} />} disabled={!activity.length} onClick={cs.resetActivity}>
            清空记录
          </Button>
        </div>
      </SettingGroup>

      <SettingGroup
        title="诊断报告"
        subtitle="最近一次环境诊断的完整结果（JSON），含各项证据，便于反馈问题；不含密钥。"
      >
        <div className="set-actions" style={{ paddingTop: 10 }}>
          <Button icon={<Download size={14} />} disabled={!report} onClick={exportReport}>
            导出诊断报告
          </Button>
        </div>
        {!report && <p className="set-note">本次运行尚未检测，请先到环境诊断页运行检测。</p>}
      </SettingGroup>
    </>
  );
}

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import type { CodeSeam } from "../../lib/useCodeSeam";
import { lastDays } from "../../lib/usage";
import { Button } from "../../components/ui/Button";
import { SettingGroup, SettingRow } from "../../components/ui/SettingRow";

/** 模型管理：首期只读。展示 Claude Code 当前使用的模型与服务端真实计量到的模型，不改写模型。 */
export function ModelSettings({ cs }: { cs: CodeSeam }) {
  const { status, cliInfo, usageReport, usageLoading, busy } = cs;
  const loggedIn = !!status?.logged_in;
  useEffect(() => {
    void cs.loadCliInfo();
  }, []);
  const models = [...(usageReport?.models ?? [])].sort((a, b) => b.requests - a.requests);
  const load = () => {
    const [s, e] = lastDays(30);
    void cs.loadUsageReport(s, e);
  };
  return (
    <>
      <SettingGroup title="当前模型" subtitle="读取自 Claude Code 的 settings.json，只读。">
        <SettingRow title="默认模型" desc="未指定时由 Claude Code 自行决定。">
          <span className="set-value mono">{cliInfo?.model || "跟随 Claude Code 默认"}</span>
        </SettingRow>
        <SettingRow title="请求超时" desc="API_TIMEOUT_MS">
          <span className="set-value">
            {cliInfo?.timeout_ms ? `${(cliInfo.timeout_ms / 1000).toLocaleString("zh-CN")} 秒` : "未设置（使用默认值）"}
          </span>
        </SettingRow>
        <p className="set-note">
          模型由 Claude Code 自身选择：在终端里输入 /model，或编辑 settings.json 的 model 字段。CodeSeam
          不改写模型，也不提供多供应商切换（第一期范围）；可用模型以你的服务套餐为准。
        </p>
      </SettingGroup>

      <SettingGroup
        title="已使用的模型"
        subtitle="来自服务端真实计量（近 30 天），用于确认实际请求命中的模型。"
      >
        {models.length > 0 ? (
          <ul className="set-list">
            {models.map((m) => (
              <li key={m.model}>
                <span className="what mono">{m.model}</span>
                <span className="set-value">{m.requests.toLocaleString("zh-CN")} 次请求</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="set-empty">
            {!loggedIn ? "登录后可查看已使用的模型。" : usageLoading ? "正在读取…" : "尚未读取用量数据。"}
          </p>
        )}
        <div className="set-actions">
          <Button
            icon={<RefreshCw size={14} className={usageLoading ? "spin" : ""} />}
            disabled={busy || !loggedIn || usageLoading}
            onClick={load}
          >
            读取近 30 天用量
          </Button>
        </div>
      </SettingGroup>
    </>
  );
}

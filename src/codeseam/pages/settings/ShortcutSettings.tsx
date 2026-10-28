import { Copy, Play, RefreshCw, Square, Stethoscope } from "lucide-react";
import type { CodeSeam } from "../../lib/useCodeSeam";
import { SHORTCUTS } from "../../lib/shortcuts";
import { Button } from "../../components/ui/Button";
import { SettingGroup, SettingRow } from "../../components/ui/SettingRow";

/** 快捷操作：常用动作一键直达 + 应用内键盘快捷键。 */
export function ShortcutSettings({ cs }: { cs: CodeSeam }) {
  const { status, busy } = cs;
  const running = !!status?.proxy_running;
  const terminal = !!status?.cli_pid;
  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(status?.local_url ?? "");
      cs.log("info", "已复制本地代理地址", status?.local_url);
    } catch {
      /* 剪贴板不可用时忽略，地址在代理设置页可手动选取。 */
    }
  };
  return (
    <>
      <SettingGroup title="常用操作" subtitle="与各页面上的同名按钮等效，条件不满足时置灰。">
        <SettingRow title="启动 Claude Code" desc="检测通过后在受管终端中启动。">
          <Button
            variant="primary"
            size="sm"
            icon={<Play size={13} />}
            disabled={busy || !running || terminal || !status?.cli}
            onClick={() => void cs.run("cs_launch")}
          >
            启动
          </Button>
        </SettingRow>
        <SettingRow title="关闭受管终端" desc="结束由 CodeSeam 启动的 Claude Code 终端。">
          <Button size="sm" icon={<Square size={12} />} disabled={busy || !terminal} onClick={() => void cs.run("cs_stop")}>
            关闭
          </Button>
        </SettingRow>
        <SettingRow title="重新检测环境" desc="运行一次完整的网络环境诊断。">
          <Button
            size="sm"
            icon={<Stethoscope size={13} />}
            disabled={busy || !running}
            onClick={() => void cs.run("cs_diagnose")}
          >
            检测
          </Button>
        </SettingRow>
        <SettingRow title="同步服务信息" desc="重新拉取服务期限、额度与网络配置。">
          <Button
            size="sm"
            icon={<RefreshCw size={13} />}
            disabled={busy || !status?.logged_in}
            onClick={() => void cs.run("cs_refresh")}
          >
            同步
          </Button>
        </SettingRow>
        <SettingRow title="复制本地代理地址" desc={<span className="mono">{status?.local_url || "—"}</span>}>
          <Button size="sm" icon={<Copy size={13} />} disabled={!status?.local_url} onClick={() => void copyUrl()}>
            复制
          </Button>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="键盘快捷键" subtitle="仅在 CodeSeam 窗口处于前台时生效。">
        <ul className="set-list">
          {SHORTCUTS.map((s) => (
            <li key={s.label}>
              <span className="what">{s.label}</span>
              <span className="kbd">
                {s.keys.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </SettingGroup>
    </>
  );
}

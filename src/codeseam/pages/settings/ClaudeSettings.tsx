import { useEffect } from "react";
import { FolderOpen } from "lucide-react";
import type { CodeSeam } from "../../lib/useCodeSeam";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { SettingGroup, SettingRow } from "../../components/ui/SettingRow";
import { ManagedConfig } from "../../components/ManagedConfig";

/** Claude Code 配置：程序检测、受管字段状态、备份与恢复。 */
export function ClaudeSettings({ cs }: { cs: CodeSeam }) {
  const { status, cliInfo, busy } = cs;
  useEffect(() => {
    void cs.loadCliInfo();
  }, []);
  const found = !!status?.cli;
  return (
    <>
      <SettingGroup title="Claude Code 程序" subtitle="从系统 PATH 自动检测官方安装，不修改其文件。">
        <SettingRow title="安装状态">
          <Badge tone={found ? "green" : "amber"}>{found ? "已安装" : "未检测到"}</Badge>
        </SettingRow>
        <SettingRow title="版本">
          <span className="set-value">{cliInfo?.version || (found ? "未能读取版本" : "—")}</span>
        </SettingRow>
        <SettingRow title="安装位置" desc={found ? undefined : "请先安装官方 Claude Code，安装后会自动识别。"}>
          <span className="set-value mono">{status?.cli || "—"}</span>
        </SettingRow>
        <SettingRow title="配置文件" desc="Claude Code 的 settings.json。">
          <span className="set-value mono">
            {cliInfo?.settings_path
              ? cliInfo.settings_exists
                ? cliInfo.settings_path
                : `${cliInfo.settings_path}（尚未创建）`
              : "—"}
          </span>
        </SettingRow>
        <SettingRow title="环境变量条目" desc="settings.json 的 env 中的键数量，不读取也不显示取值。">
          <span className="set-value">{cliInfo ? cliInfo.env_count : "—"}</span>
        </SettingRow>
        <div className="set-actions">
          <Button
            icon={<FolderOpen size={14} />}
            disabled={busy}
            onClick={() => void cs.run("cs_open_path", { kind: "claude" })}
          >
            打开配置目录
          </Button>
        </div>
      </SettingGroup>

      <SettingGroup
        title="受管配置"
        subtitle="只改写 API 地址与授权两个字段；其余设置（权限、模型、钩子等）保持原样。"
      >
        <SettingRow title="配置状态" desc="Claude Code 的 API 入口是否已指向本地受管代理。">
          <Badge tone={status?.configured ? "green" : "amber"}>
            {status?.configured ? "已指向本地代理" : "未配置或已被改动"}
          </Badge>
        </SettingRow>
        <SettingRow title="API 地址" desc="ANTHROPIC_BASE_URL">
          <span className="set-value mono">{status?.local_url || "—"}</span>
        </SettingRow>
        <SettingRow title="授权令牌" desc="ANTHROPIC_AUTH_TOKEN：仅为本地占位值，真实服务授权保留在 CodeSeam 本地服务。">
          <span className="set-value">本地占位令牌</span>
        </SettingRow>
        <ManagedConfig cs={cs} />
        <p className="set-note">
          恢复原配置会还原备份的字段；若外部改动了受管字段则不会覆盖，并保留加密备份。受管终端运行时无法恢复。
        </p>
      </SettingGroup>
    </>
  );
}

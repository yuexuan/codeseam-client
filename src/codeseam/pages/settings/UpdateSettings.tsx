import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { ExternalLink } from "lucide-react";
import type { CodeSeam } from "../../lib/useCodeSeam";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { SettingGroup, SettingRow } from "../../components/ui/SettingRow";

/** 版本更新：当前版本与获取新版本的方式。没有自有更新渠道时如实说明，不伪造“已是最新”。 */
export function UpdateSettings({ cs }: { cs: CodeSeam }) {
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion("0.5.0"));
  }, []);
  return (
    <SettingGroup title="版本信息">
      <SettingRow title="当前版本" desc="CodeSeam Windows 客户端（MVP）。">
        <span className="set-value">{version ? `v${version}` : "—"}</span>
      </SettingRow>
      <SettingRow
        title="自动更新"
        desc="CodeSeam 自有更新渠道将在正式发布前接入；当前不会访问任何上游（Z-Switch）更新地址。"
      >
        <Badge tone="amber">暂未启用</Badge>
      </SettingRow>
      <SettingRow title="获取新版本" desc="新版安装包由用户服务门户提供；覆盖安装即可升级，登录状态与配置备份会保留。">
        <Button
          size="sm"
          icon={<ExternalLink size={13} />}
          disabled={cs.busy || !cs.portal}
          onClick={() => void cs.run("cs_open_portal", { url: cs.portal })}
        >
          打开用户门户
        </Button>
      </SettingRow>
      <p className="set-note">
        卸载时会先恢复受管的 Claude 配置字段；若字段被外部改动，则保留加密备份并中止卸载，请先在客户端内恢复或处理。
      </p>
    </SettingGroup>
  );
}

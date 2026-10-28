import { FolderOpen } from "lucide-react";
import type { CodeSeam } from "../../lib/useCodeSeam";
import { Button } from "../../components/ui/Button";
import { SettingGroup } from "../../components/ui/SettingRow";
import license from "../../../../LICENSE?raw";
import notice from "../../../../PRODUCT-NOTICE.txt?raw";

const COMPONENTS: [string, string][] = [
  ["CodeSeam 客户端", "基于 Z-Switch · MIT"],
  ["CodeSeam 服务端", "基于 Sub2API · LGPL-3.0（不随安装包分发）"],
  ["Tauri / React / Rust 生态依赖", "各自遵循其开源许可"],
];

/** 许可证：开源组件归属、许可文本与产品声明（随安装包附带）。 */
export function LicenseSettings({ cs }: { cs: CodeSeam }) {
  return (
    <>
      <SettingGroup title="开源组件" subtitle="CodeSeam 建立在以下开源项目之上，源码与许可说明随安装包附带。">
        <div className="dep-grid">
          {COMPONENTS.map(([name, lic]) => (
            <div key={name}>
              <strong>{name}</strong>
              <span>{lic}</span>
            </div>
          ))}
        </div>
        <div className="set-actions">
          <Button
            icon={<FolderOpen size={14} />}
            disabled={cs.busy}
            onClick={() => void cs.run("cs_open_path", { kind: "license" })}
          >
            打开许可文件目录
          </Button>
        </div>
      </SettingGroup>
      <SettingGroup title="许可证（LICENSE）">
        <pre className="license-text">{license.trim()}</pre>
      </SettingGroup>
      <SettingGroup title="产品声明（PRODUCT-NOTICE）">
        <pre className="license-text">{notice.trim()}</pre>
      </SettingGroup>
    </>
  );
}

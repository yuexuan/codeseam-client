import { useEffect, useState } from "react";
import { FolderOpen, Save } from "lucide-react";
import type { CodeSeam } from "../../lib/useCodeSeam";
import { Button } from "../../components/ui/Button";
import { SettingGroup, SettingRow } from "../../components/ui/SettingRow";

/** 工作目录：受管 Claude Code 终端启动时所在的目录，以及常用目录入口。 */
export function WorkDirSettings({ cs }: { cs: CodeSeam }) {
  const { prefs, busy } = cs;
  const [dir, setDir] = useState("");
  useEffect(() => {
    if (prefs) setDir(prefs.work_dir);
  }, [prefs?.work_dir]);
  const dirty = !!prefs && dir.trim() !== prefs.work_dir;
  return (
    <>
      <SettingGroup
        title="Claude Code 工作目录"
        subtitle="点击“启动 Claude Code”时，受管终端在此目录下打开；留空则沿用 CodeSeam 的启动目录。"
      >
        <SettingRow title="目录路径" desc="例如 D:\code\my-project；目录必须已存在。" stack>
          <div className="set-input">
            <input
              aria-label="工作目录"
              placeholder="未设置"
              value={dir}
              disabled={!prefs}
              onChange={(e) => setDir(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && dirty && void cs.savePrefs({ work_dir: dir })}
            />
          </div>
        </SettingRow>
        <div className="set-actions">
          <Button
            variant="primary"
            icon={<Save size={14} />}
            disabled={!dirty}
            onClick={() => void cs.savePrefs({ work_dir: dir })}
          >
            保存
          </Button>
          <Button
            disabled={!prefs?.work_dir}
            onClick={() => {
              setDir("");
              void cs.savePrefs({ work_dir: "" });
            }}
          >
            清除
          </Button>
          <Button
            icon={<FolderOpen size={14} />}
            disabled={busy || !prefs?.work_dir}
            onClick={() => void cs.run("cs_open_path", { kind: "work" })}
          >
            打开目录
          </Button>
        </div>
        <p className="set-note">更改只影响之后新启动的终端；已运行的受管终端不受影响。</p>
      </SettingGroup>

      <SettingGroup title="常用目录">
        <SettingRow title="Claude 配置目录" desc="settings.json 等 Claude Code 配置所在位置。">
          <Button size="sm" disabled={busy} onClick={() => void cs.run("cs_open_path", { kind: "claude" })}>
            打开
          </Button>
        </SettingRow>
        <SettingRow
          title="CodeSeam 数据目录"
          desc={prefs?.data_dir ? <span className="mono">{prefs.data_dir}</span> : "加密会话与配置备份（Windows DPAPI）的存放位置。"}
        >
          <Button size="sm" disabled={busy} onClick={() => void cs.run("cs_open_path", { kind: "data" })}>
            打开
          </Button>
        </SettingRow>
        <p className="set-note">数据目录中的 .dpapi 文件只能由当前 Windows 用户解密，请勿手工修改或删除。</p>
      </SettingGroup>
    </>
  );
}

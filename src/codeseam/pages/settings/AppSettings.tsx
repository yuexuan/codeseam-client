import { Check, Monitor, Moon, Sun } from "lucide-react";
import type { CodeSeam } from "../../lib/useCodeSeam";
import { ACCENTS, ZOOMS, zoomLabel } from "../../lib/uiPrefs";
import { SettingGroup, SettingRow } from "../../components/ui/SettingRow";
import { Segmented } from "../../components/ui/Segmented";
import { Toggle } from "../../components/ui/Toggle";

/** 应用设置：主题与界面（本机显示偏好）、启动与行为（后端持久化）、通知。 */
export function AppSettings({ cs }: { cs: CodeSeam }) {
  const { uiPrefs, setUiPref, prefs, autostart } = cs;
  return (
    <>
      <SettingGroup title="主题与界面">
        <SettingRow title="应用主题" desc="选择应用的主题风格。">
          <Segmented
            label="应用主题"
            value={uiPrefs.themeMode}
            onChange={(v) => setUiPref("themeMode", v)}
            options={[
              { id: "light", label: "浅色", icon: <Sun size={13} /> },
              { id: "dark", label: "深色", icon: <Moon size={13} /> },
              { id: "system", label: "跟随系统", icon: <Monitor size={13} /> },
            ]}
          />
        </SettingRow>
        <SettingRow title="主色调" desc="选择应用的主色调。">
          <div className="swatches" role="radiogroup" aria-label="主色调">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={uiPrefs.accent === a.id}
                aria-label={a.label}
                title={a.label}
                className={`swatch${uiPrefs.accent === a.id ? " selected" : ""}`}
                style={{ background: a.swatch }}
                onClick={() => setUiPref("accent", a.id)}
              >
                {uiPrefs.accent === a.id && <Check size={14} strokeWidth={3} />}
              </button>
            ))}
          </div>
        </SettingRow>
        <SettingRow title="界面语言" desc="选择应用的显示语言。">
          <select
            className="select"
            aria-label="界面语言"
            value={uiPrefs.lang}
            onChange={() => setUiPref("lang", "zh-CN")}
          >
            <option value="zh-CN">简体中文</option>
            <option disabled>English（暂未提供）</option>
          </select>
        </SettingRow>
        <SettingRow title="界面缩放" desc="调整界面整体大小。">
          <select
            className="select"
            aria-label="界面缩放"
            value={uiPrefs.zoom}
            onChange={(e) => setUiPref("zoom", Number(e.target.value))}
          >
            {ZOOMS.map((z) => (
              <option key={z} value={z}>
                {zoomLabel(z)}
              </option>
            ))}
          </select>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="启动与行为">
        <SettingRow
          title="开机自动启动"
          desc={
            autostart === undefined
              ? "系统登录后自动启动 CodeSeam（当前环境无法读取启动项状态）。"
              : "系统登录后自动启动 CodeSeam。"
          }
        >
          <Toggle
            label="开机自动启动"
            checked={!!autostart}
            disabled={autostart === undefined}
            onChange={(v) => void cs.setAutostart(v)}
          />
        </SettingRow>
        <SettingRow title="启动后最小化" desc="启动后自动最小化到任务栏。">
          <Toggle
            label="启动后最小化"
            checked={!!prefs?.start_minimized}
            disabled={!prefs}
            onChange={(v) => void cs.savePrefs({ start_minimized: v })}
          />
        </SettingRow>
        <SettingRow
          title="启动时自动连接"
          desc="启动后自动恢复上次登录并连接本地代理；关闭后需在 Claude Code 页手动连接。"
        >
          <Toggle
            label="启动时自动连接"
            checked={!!prefs?.auto_connect}
            disabled={!prefs}
            onChange={(v) => void cs.savePrefs({ auto_connect: v })}
          />
        </SettingRow>
        <SettingRow
          title="关闭时最小化到托盘"
          desc={
            prefs && !prefs.tray
              ? "当前环境未能创建托盘图标，点击关闭将直接退出。"
              : "点击关闭按钮时，最小化到系统托盘；关闭此项则直接退出并停止代理。"
          }
        >
          <Toggle
            label="关闭时最小化到托盘"
            checked={!!prefs?.close_to_tray}
            disabled={!prefs}
            onChange={(v) => void cs.savePrefs({ close_to_tray: v })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="通知设置" subtitle="通知显示在应用窗口顶部；错误提示始终显示，不受开关影响。">
        <SettingRow title="连接状态通知" desc="代理连接状态变化时显示通知。">
          <Toggle
            label="连接状态通知"
            checked={uiPrefs.notifyConn}
            onChange={(v) => setUiPref("notifyConn", v)}
          />
        </SettingRow>
        <SettingRow title="重要事件通知" desc="启动、配置、诊断完成等重要事件通知。">
          <Toggle
            label="重要事件通知"
            checked={uiPrefs.notifyEvents}
            onChange={(v) => setUiPref("notifyEvents", v)}
          />
        </SettingRow>
      </SettingGroup>
    </>
  );
}

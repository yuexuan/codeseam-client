import { Fragment, useEffect, type ReactElement } from "react";
import {
  CircleHelp,
  FolderOpen,
  Globe,
  Boxes,
  ScrollText,
  Scale,
  Server,
  SlidersHorizontal,
  SquareTerminal,
  Zap,
  CircleArrowUp,
} from "lucide-react";
import type { CodeSeam } from "../lib/useCodeSeam";
import type { PageId, SettingsTab } from "../lib/types";
import { AppSettings } from "./settings/AppSettings";
import { ProxySettings } from "./settings/ProxySettings";
import { NetworkSettings } from "./settings/NetworkSettings";
import { ClaudeSettings } from "./settings/ClaudeSettings";
import { ModelSettings } from "./settings/ModelSettings";
import { WorkDirSettings } from "./settings/WorkDirSettings";
import { LogSettings } from "./settings/LogSettings";
import { ShortcutSettings } from "./settings/ShortcutSettings";
import { UpdateSettings } from "./settings/UpdateSettings";
import { LicenseSettings } from "./settings/LicenseSettings";
import { HelpSettings } from "./settings/HelpSettings";

interface Tab {
  id: SettingsTab;
  label: string;
  subtitle: string;
  icon: ReactElement;
}

const GROUPS: { label: string; tabs: Tab[] }[] = [
  {
    label: "基础设置",
    tabs: [
      { id: "app", label: "应用设置", subtitle: "自定义 CodeSeam 的界面、行为和启动选项。", icon: <SlidersHorizontal size={16} /> },
      { id: "proxy", label: "代理设置", subtitle: "服务连接地址、本地代理运行状态与账号。", icon: <Server size={16} /> },
      { id: "network", label: "网络与环境", subtitle: "网络保护策略、最近检测结果与环境修复。", icon: <Globe size={16} /> },
      { id: "claude", label: "Claude Code 配置", subtitle: "Claude Code 程序检测与受管配置的备份、恢复。", icon: <SquareTerminal size={16} /> },
      { id: "models", label: "模型管理", subtitle: "查看 Claude Code 当前模型与实际使用过的模型。", icon: <Boxes size={16} /> },
    ],
  },
  {
    label: "工具与数据",
    tabs: [
      { id: "workdir", label: "工作目录", subtitle: "设置受管 Claude Code 终端的启动目录，并快速打开常用目录。", icon: <FolderOpen size={16} /> },
      { id: "logs", label: "日志与记录", subtitle: "客户端活动记录与诊断报告，可导出或清空。", icon: <ScrollText size={16} /> },
      { id: "shortcuts", label: "快捷操作", subtitle: "常用操作一键直达，以及应用内键盘快捷键。", icon: <Zap size={16} /> },
    ],
  },
  {
    label: "关于",
    tabs: [
      { id: "updates", label: "版本更新", subtitle: "当前版本与获取新版本的方式。", icon: <CircleArrowUp size={16} /> },
      { id: "license", label: "许可证", subtitle: "开源组件归属与许可文本。", icon: <Scale size={16} /> },
      { id: "help", label: "帮助与反馈", subtitle: "常见问题、诊断信息与反馈入口。", icon: <CircleHelp size={16} /> },
    ],
  },
];

const ALL = GROUPS.flatMap((g) => g.tabs);

/** 设置：左侧二级导航（三组 11 项）+ 右侧内容；偏好即时生效，无需“保存”。 */
export function SettingsPage({
  cs,
  setPage,
}: {
  cs: CodeSeam;
  setPage: (p: PageId) => void;
}) {
  const tab = cs.settingsTab;
  const cur = ALL.find((t) => t.id === tab) ?? ALL[0];

  useEffect(() => {
    void cs.loadPrefs();
  }, []);

  return (
    <div className="sub-layout">
      <aside className="sub-nav" aria-label="设置">
        <h2>设置</h2>
        <nav>
          {GROUPS.map((g) => (
            <Fragment key={g.label}>
              <span className="subnav-label">{g.label}</span>
              {g.tabs.map((t) => (
                <button
                  key={t.id}
                  className={`subnav-btn${tab === t.id ? " selected" : ""}`}
                  aria-current={tab === t.id ? "page" : undefined}
                  onClick={() => cs.setSettingsTab(t.id)}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </Fragment>
          ))}
        </nav>
      </aside>
      <section className="sub-main">
        <div className="page-header">
          <div>
            <h1>{cur.label}</h1>
            <p>{cur.subtitle}</p>
          </div>
        </div>
        {cur.id === "app" && <AppSettings cs={cs} />}
        {cur.id === "proxy" && <ProxySettings cs={cs} />}
        {cur.id === "network" && <NetworkSettings cs={cs} setPage={setPage} />}
        {cur.id === "claude" && <ClaudeSettings cs={cs} />}
        {cur.id === "models" && <ModelSettings cs={cs} />}
        {cur.id === "workdir" && <WorkDirSettings cs={cs} />}
        {cur.id === "logs" && <LogSettings cs={cs} />}
        {cur.id === "shortcuts" && <ShortcutSettings cs={cs} />}
        {cur.id === "updates" && <UpdateSettings cs={cs} />}
        {cur.id === "license" && <LicenseSettings cs={cs} />}
        {cur.id === "help" && <HelpSettings cs={cs} setPage={setPage} />}
      </section>
    </div>
  );
}

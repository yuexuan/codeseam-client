import { useEffect, useState } from "react";
import { Titlebar } from "./components/Titlebar";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { OverviewPage } from "./pages/OverviewPage";
import { ClaudeCodePage } from "./pages/ClaudeCodePage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { UsagePage } from "./pages/UsagePage";
import { SettingsPage } from "./pages/SettingsPage";
import { useCodeSeam } from "./lib/useCodeSeam";
import type { PageId } from "./lib/types";
import { PAGE_KEYS, SETTINGS_KEY } from "./lib/shortcuts";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/usage.css";
import "./styles/settings.css";

/** 应用外壳：无边框标题栏 + 左侧菜单 + 内容区 + 底部状态栏。 */
export default function App() {
  const cs = useCodeSeam();
  const [page, setPage] = useState<PageId>("overview");

  // 应用内快捷键：Ctrl+1..5 切换页面，Ctrl+, 打开设置。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
      const target = e.key === SETTINGS_KEY ? "settings" : PAGE_KEYS[e.key];
      if (!target) return;
      e.preventDefault();
      setPage(target);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="shell">
      <Titlebar cs={cs} />
      <div className="shell-body">
        <Sidebar cs={cs} page={page} onSelect={setPage} />
        <div className="main">
          <main className="content">
            {cs.error && (
              <div className="error" role="alert">
                {cs.error}
              </div>
            )}
            {cs.notice && (
              <div className="notice" role="status">
                {cs.notice}
              </div>
            )}
            {page === "overview" && <OverviewPage cs={cs} setPage={setPage} />}
            {page === "diagnostics" && <DiagnosticsPage cs={cs} setPage={setPage} />}
            {page === "claude" && <ClaudeCodePage cs={cs} setPage={setPage} />}
            {page === "usage" && <UsagePage cs={cs} />}
            {page === "settings" && <SettingsPage cs={cs} setPage={setPage} />}
          </main>
          <StatusBar cs={cs} />
        </div>
      </div>
    </div>
  );
}
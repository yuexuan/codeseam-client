import { useEffect, useState } from "react";
import { Titlebar } from "./components/Titlebar";
import { LoginDialog } from "./components/LoginDialog";
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
  const [page, updatePage] = useState<PageId>("overview");
  const setPage = (next: PageId) => {
    if (next === page) return;
    if (cs.diagnosticsBusy) return;
    if (cs.diagnosticsDirty && !window.confirm("环境配置有未应用的草稿。离开将放弃这些编辑，是否继续？")) return;
    cs.setDiagnosticsDirty(false);
    updatePage(next);
  };

  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (!cs.diagnosticsDirty && !cs.diagnosticsBusy) return;
      e.preventDefault(); e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [cs.diagnosticsDirty, cs.diagnosticsBusy]);

  const [loginOpen, setLoginOpen] = useState(false);

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
  }, [page, cs.diagnosticsDirty, cs.diagnosticsBusy]);
  return (
    <div className="shell">
      <Titlebar cs={cs} />
      <div className="shell-body">
        <Sidebar cs={cs} page={page} onSelect={setPage} onAccount={() => {
          if (cs.status?.logged_in) {
            cs.setSettingsTab("proxy");
            setPage("settings");
          } else setLoginOpen(true);
        }} />
        <div className="main">
          <main className="content">
            {import.meta.env.DEV && new URLSearchParams(location.search).get("qa")==="diagnostics" && <p className="env-note" role="note">开发预览 · 以下为界面验证用示例数据</p>}
            {cs.error && (
              <div className="error" role="alert">
                {cs.error}
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
      {cs.notice && (
        <div className="notice app-toast" role="status">
          <span>{cs.notice}</span>
          <button type="button" aria-label="关闭提示" onClick={cs.dismissNotice}>×</button>
        </div>
      )}
      <LoginDialog cs={cs} open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}

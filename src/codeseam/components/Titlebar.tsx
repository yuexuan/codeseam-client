import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Moon, Square, Sun, X } from "lucide-react";
import type { CodeSeam } from "../lib/useCodeSeam";
import logo from "../assets/codeseam-logo.svg";

/** Tauri 环境下才存在；普通浏览器里打开时保持渲染（控件仅空操作）。 */
const hasTauri = typeof window !== "undefined" && !!(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
const win = hasTauri ? getCurrentWindow() : undefined;

/** 无边框窗口标题栏：品牌区 + 拖拽区 + 主题切换 + 窗口控件。
 * 关闭请求交给后端按“关闭时最小化到托盘”设置处理：开启则隐藏到托盘，否则退出。 */
export function Titlebar({ cs }: { cs: CodeSeam }) {
  const [maxed, setMaxed] = useState(false);

  useEffect(() => {
    if (!win) return;
    void win.isMaximized().then(setMaxed).catch(() => {});
    const unResize = win.onResized(() => {
      void win.isMaximized().then(setMaxed).catch(() => {});
    });
    return () => {
      void unResize.then((f) => f()).catch(() => {});
    };
  }, []);

  return (
    <header className="titlebar">
      <div className="titlebar-brand" data-tauri-drag-region>
        <img src={logo} alt="CodeSeam" data-tauri-drag-region />
        <span data-tauri-drag-region>CodeSeam</span>
      </div>
      <div className="titlebar-spacer" data-tauri-drag-region />
      <button
        className="icon-btn"
        aria-label="切换明暗主题"
        title="切换明暗主题"
        onClick={cs.toggleTheme}
      >
        {cs.theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
      </button>
      <div className="win-controls">
        <button title="最小化" aria-label="最小化" onClick={() => void win?.minimize()}>
          <Minus size={14} />
        </button>
        <button
          title={maxed ? "还原" : "最大化"}
          aria-label={maxed ? "还原" : "最大化"}
          onClick={() => void win?.toggleMaximize()}
        >
          {maxed ? <Copy size={12} /> : <Square size={11} />}
        </button>
        <button
          className="close"
          title={cs.prefs?.close_to_tray && cs.prefs.tray ? "最小化到托盘" : "关闭"}
          aria-label="关闭"
          onClick={() => void win?.close()}
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
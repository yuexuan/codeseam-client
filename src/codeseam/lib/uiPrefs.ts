/** 界面偏好（主题、主色调、语言、缩放、通知）：只影响本机显示，存 localStorage。 */

import { getCurrentWebview } from "@tauri-apps/api/webview";

export type ThemeMode = "light" | "dark" | "system";
export type Accent = "gold" | "amber" | "bronze" | "terracotta" | "rose";

export interface UiPrefs {
  themeMode: ThemeMode;
  accent: Accent;
  /** 目前仅提供简体中文，字段为后续多语言预留。 */
  lang: "zh-CN";
  zoom: number;
  /** 本地代理连接状态变化时在应用内提示。 */
  notifyConn: boolean;
  /** 操作完成、启动等事件在应用内提示（错误始终显示）。 */
  notifyEvents: boolean;
}

/** 主色调预设；swatch 用于色块展示，实际变量见 tokens.css 的 data-accent 规则。 */
export const ACCENTS: { id: Accent; label: string; swatch: string }[] = [
  { id: "gold", label: "铜金", swatch: "#b87324" },
  { id: "amber", label: "琥珀", swatch: "#c68a1a" },
  { id: "bronze", label: "青铜", swatch: "#8a6a4a" },
  { id: "terracotta", label: "赤陶", swatch: "#b4593b" },
  { id: "rose", label: "玫瑰", swatch: "#b0606e" },
];

export const ZOOMS = [0.9, 1, 1.1, 1.25];

const KEY = "cs.ui";
const LEGACY_THEME = "cs.theme";

const DEFAULTS: UiPrefs = {
  themeMode: "light",
  accent: "gold",
  lang: "zh-CN",
  zoom: 1,
  notifyConn: true,
  notifyEvents: true,
};

export function loadUiPrefs(): UiPrefs {
  let saved: Partial<UiPrefs> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    /* 损坏的偏好按默认值处理。 */
  }
  const legacy = localStorage.getItem(LEGACY_THEME);
  const merged = { ...DEFAULTS, ...saved };
  if (!saved.themeMode && (legacy === "light" || legacy === "dark")) merged.themeMode = legacy;
  if (!["light", "dark", "system"].includes(merged.themeMode)) merged.themeMode = "light";
  if (!ACCENTS.some((a) => a.id === merged.accent)) merged.accent = "gold";
  if (!ZOOMS.includes(merged.zoom)) merged.zoom = 1;
  return merged;
}

export const saveUiPrefs = (p: UiPrefs) => localStorage.setItem(KEY, JSON.stringify(p));

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

/** 把“跟随系统”解析为具体的明/暗。 */
export const resolveTheme = (mode: ThemeMode): "light" | "dark" =>
  mode === "system" ? (darkQuery().matches ? "dark" : "light") : mode;

export const watchSystemTheme = (cb: () => void) => {
  const q = darkQuery();
  q.addEventListener("change", cb);
  return () => q.removeEventListener("change", cb);
};

const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 整体缩放：Tauri 内用 WebView 缩放，浏览器预览退回 CSS zoom。 */
export async function applyZoom(zoom: number) {
  if (hasTauri) {
    await getCurrentWebview().setZoom(zoom);
  } else {
    document.documentElement.style.zoom = zoom === 1 ? "" : String(zoom);
  }
}

export const zoomLabel = (z: number) => `${Math.round(z * 100)}%${z === 1 ? "（推荐）" : ""}`;

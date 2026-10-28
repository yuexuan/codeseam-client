import type { PageId } from "./types";

/** 应用内键盘快捷键（Ctrl + 键）。App 监听，快捷操作页展示。 */
export const PAGE_KEYS: Record<string, PageId> = {
  "1": "overview",
  "2": "diagnostics",
  "3": "claude",
  "4": "usage",
  "5": "settings",
};

export const SETTINGS_KEY = ",";

export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["Ctrl", "1"], label: "概览" },
  { keys: ["Ctrl", "2"], label: "环境诊断" },
  { keys: ["Ctrl", "3"], label: "Claude Code" },
  { keys: ["Ctrl", "4"], label: "用量管理" },
  { keys: ["Ctrl", "5"], label: "设置" },
  { keys: ["Ctrl", ","], label: "打开设置" },
];

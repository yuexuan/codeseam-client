import { getCurrentWindow } from '@tauri-apps/api/window';
export interface WindowControls {
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  close(): Promise<void>;
}
export const nativeWindow: WindowControls = {
  minimize: () => getCurrentWindow().minimize(),
  maximize: () => getCurrentWindow().toggleMaximize(),
  close: () => getCurrentWindow().close(),
};
export const previewWindow: WindowControls = {
  minimize: () => Promise.reject(new Error('浏览器预览不支持窗口最小化')),
  maximize: () => Promise.reject(new Error('浏览器预览不支持窗口最大化')),
  close: () => Promise.reject(new Error('请使用浏览器标签页关闭预览')),
};

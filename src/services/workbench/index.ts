import {
  commands,
  type CleanupReport,
  type RuntimeReport,
} from '../../bindings/commands';
import { call } from '../../core/ipc/call';
import { type BrowserResult, createBrowserPreview } from '../browser';
export interface WorkbenchRecord {
  schema: number;
  confirmedAt: string;
  alias: string;
  region: string;
  virtualRuntime: boolean;
  baseline: BrowserResult;
  runtime: RuntimeReport | null;
  cleanup: CleanupReport;
  observation: {
    at: string;
    runtime: RuntimeReport | null;
    processes: Record<
      'code' | 'desktop' | 'web',
      { count: number; installed: boolean }
    > | null;
    error: string | null;
  } | null;
  events: { at: string; message: string; level: string }[];
}
export interface Confirmation {
  alias: string;
  region: string;
  virtualRuntime: boolean;
  browser: string;
}
export interface WorkbenchService {
  read(): Promise<WorkbenchRecord | null>;
  confirm(input: Confirmation): Promise<WorkbenchRecord>;
  refresh(): Promise<WorkbenchRecord>;
  open(): Promise<WorkbenchRecord>;
  install(app: 'code' | 'desktop'): Promise<WorkbenchRecord>;
}
async function operation(action: string, payload: unknown = {}) {
  return call('workbench_operation', async () => {
    const result = await commands.workbenchOperation(
      action,
      JSON.stringify(payload),
    );
    if (result.status === 'error') throw result.error;
    return JSON.parse(result.data);
  });
}
export const nativeWorkbench: WorkbenchService = {
  read: () => operation('read'),
  confirm: (input) => operation('confirm', input),
  refresh: () => operation('refresh'),
  open: () => operation('open'),
  install: (app) => operation(`install_${app}`),
};
export function createWorkbenchPreview(
  scenario: string,
  seedRuntime?: boolean,
): WorkbenchService {
  const key = `codeseam-preview-workbench-${scenario}`;
  let record: WorkbenchRecord | null = null;
  const save = () => sessionStorage.setItem(key, JSON.stringify(record));
  return {
    async read() {
      record = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      if (!record && seedRuntime !== undefined) {
        await this.confirm({
          alias: '',
          region: '',
          virtualRuntime: seedRuntime,
          browser: 'edge',
        });
      }
      return record ? { ...record, observation: null } : null;
    },
    async confirm(input) {
      if (scenario === 'error' || scenario === 'save-error')
        throw new Error('正式基线保存失败，请重试。');
      const baseline = await createBrowserPreview('default').confirm(
        input.virtualRuntime,
        input.browser,
      );
      record = {
        schema: 1,
        confirmedAt: new Date().toISOString(),
        alias: input.alias.trim(),
        region: input.region,
        virtualRuntime: input.virtualRuntime,
        baseline,
        runtime: null,
        cleanup: {
          items: [],
          warnings: [],
          codeInstalled: false,
          desktopInstalled: false,
          canRestore: false,
        },
        observation: null,
        events: [
          {
            at: new Date().toISOString(),
            message: '用户确认初始化，正式环境基线已保存',
            level: 'success',
          },
          {
            at: new Date().toISOString(),
            message: '持续 Guardian 与进程路径保护尚未接通，保护状态待验证',
            level: 'warning',
          },
        ],
      };
      save();
      return record;
    },
    async refresh() {
      record ??= JSON.parse(sessionStorage.getItem(key) ?? 'null');
      if (!record) throw new Error('请先完成初始化');
      await new Promise((resolve) => setTimeout(resolve, 600));
      record = {
        ...record,
        observation: {
          at: new Date().toISOString(),
          runtime: null,
          processes: {
            web: { count: 0, installed: true },
            code: { count: 0, installed: false },
            desktop: { count: 0, installed: false },
          },
          error:
            scenario === 'failure' || scenario === 'refresh-error'
              ? '当前出口无法复验，请检查节点连接'
              : null,
        },
        events: [
          ...record.events,
          {
            at: new Date().toISOString(),
            message:
              scenario === 'failure' || scenario === 'refresh-error'
                ? '开发预览：当前出口复验失败，请检查节点连接'
                : '开发预览检测完成；真实运行环境与保护路径待验证',
            level:
              scenario === 'failure' || scenario === 'refresh-error'
                ? 'warning'
                : 'info',
          },
        ],
      };
      save();
      return record;
    },
    async open() {
      record ??= JSON.parse(sessionStorage.getItem(key) ?? 'null');
      if (!record) throw new Error('请先完成初始化');
      record = {
        ...record,
        events: [
          ...record.events,
          {
            at: new Date().toISOString(),
            message: '开发预览：已模拟请求打开专用 Claude Web 浏览器',
            level: 'info',
          },
        ],
      };
      save();
      return record;
    },
    async install(app) {
      record ??= JSON.parse(sessionStorage.getItem(key) ?? 'null');
      if (!record) throw new Error('请先完成初始化');
      record = {
        ...record,
        events: [
          ...record.events,
          {
            at: new Date().toISOString(),
            message: `开发预览：已模拟打开 Claude ${app === 'code' ? 'Code' : 'Desktop'} 官方安装入口`,
            level: 'info',
          },
        ],
      };
      save();
      return record;
    },
  };
}
export function formatTime(value?: string) {
  if (!value) return '尚未检测';
  const date = new Date(/^\d+$/.test(value) ? Number(value) * 1000 : value);
  return Number.isNaN(date.getTime())
    ? '时间未知'
    : date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
}

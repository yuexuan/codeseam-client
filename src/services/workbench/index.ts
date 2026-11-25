import { listen } from '@tauri-apps/api/event';
import type { BrowserSnapshot, DailyBrowserDetails } from '../browser/daily';
import {
  commands,
  type CleanupReport,
  type RuntimeReport,
} from '../../bindings/commands';
import { call } from '../../core/ipc/call';
import { type BrowserResult, createBrowserPreview } from '../browser';
import type { EnvironmentDetails } from '../runtime/environment';
export interface AppProcess {
  count: number;
  installed: boolean;
  protection?: 'covered' | 'uncovered' | 'idle';
  instances?: {
    id: number;
    parentId: number;
    root: boolean;
    source: string;
    covered: boolean;
    observedAt: string;
  }[];
}
export interface WorkbenchRecord {
  schema: number;
  baselineVersion?: number;
  nodeCountry?: { code: string; region: string | null };
  confirmedAt: string;
  alias: string;
  region: string;
  virtualRuntime: boolean;
  baseline: BrowserResult;
  runtime: RuntimeReport | null;
  cleanup: CleanupReport;
  guardian?: {
    state: 'monitoring' | 'limited' | 'locked' | 'offline' | 'unknown';
    at: string;
    error?: string | null;
    limitation?: string | null;
    verifiedAt?: string | null;
  };
  observation: {
    at: string;
    runtime: RuntimeReport | null;
    environment?: EnvironmentDetails;
    browser?: BrowserSnapshot;
    processes: Record<'code' | 'desktop' | 'web', AppProcess> | null;
    error: string | null;
  } | null;
  events: {
    id?: string;
    at: string;
    message: string;
    level: string;
    object?: string;
    before?: unknown;
    after?: unknown;
    action?: string;
    runtimeId?: string;
  }[];
  reconfiguration?: {
    virtualRuntime: boolean;
    startedAt: string;
    backup: string;
  } | null;
}
export interface Confirmation {
  alias: string;
  region: string;
  virtualRuntime: boolean;
  browser: string;
}
export interface ResetOptions {
  local: boolean;
  virtual: boolean;
  keepBackup: boolean;
}
export interface ResetResult {
  completed: boolean;
  backupPath: string | null;
}
export type CheckScope = 'all' | 'runtime' | 'browser';
export interface WorkbenchService {
  subscribe?(
    observed: (record: WorkbenchRecord) => void,
    failed: (error: string) => void,
  ): Promise<() => void>;
  reset(options: ResetOptions): Promise<ResetResult>;
  read(): Promise<WorkbenchRecord | null>;
  confirm(input: Confirmation): Promise<WorkbenchRecord>;
  refresh(scope?: CheckScope): Promise<WorkbenchRecord>;
  open(): Promise<WorkbenchRecord>;
  install(app: 'code' | 'desktop'): Promise<WorkbenchRecord>;
  app(
    app: 'web' | 'code' | 'desktop',
    action: 'start' | 'stop',
  ): Promise<WorkbenchRecord>;
  recover(): Promise<WorkbenchRecord>;
  prepareExit(
    force: boolean,
  ): Promise<{ stopped: boolean; remaining: { id: number; app: string }[] }>;
  preferences(): Promise<{ startup: boolean; registered: boolean }>;
  history(
    cursor?: string,
  ): Promise<{ events: WorkbenchRecord['events']; cursor: string | null }>;
  setStartup(
    enabled: boolean,
  ): Promise<{ startup: boolean; registered: boolean }>;
}
async function operation(action: string, payload: unknown = {}) {
  const labels: Record<string, string> = {
    read: '读取工作台',
    confirm: '保存正式基线',
    reset: '重置环境',
    refresh: '检测工作台',
    refresh_runtime: '检测运行环境',
    refresh_browser: '检测专用浏览器',
    open: '打开 Claude',
    install_code: '打开 Claude Code 安装页',
    install_desktop: '打开 Claude Desktop 下载页',
  };
  return call(labels[action] ?? '工作台操作', async () => {
    const result = await commands.workbenchOperation(
      action,
      JSON.stringify(payload),
    );
    if (result.status === 'error') throw result.error;
    return JSON.parse(result.data);
  });
}
export const nativeWorkbench: WorkbenchService = {
  reset: (options) => operation('reset', options),
  read: () => operation('read'),
  confirm: (input) => operation('confirm', input),
  refresh: (scope = 'all') =>
    operation(scope === 'all' ? 'refresh' : `refresh_${scope}`),
  async subscribe(observed, failed) {
    const stop = await listen<string>('daily-observed', (event) =>
      observed(JSON.parse(event.payload)),
    );
    try {
      const stopError = await listen<string>(
        'daily-observation-error',
        (event) => failed(event.payload),
      );
      return () => {
        stop();
        stopError();
      };
    } catch (error) {
      stop();
      throw error;
    }
  },
  open: () => operation('open'),
  install: (app) => operation(`install_${app}`),
  app: (app, action) => operation(`app_${action}`, { app }),
  recover: () => operation('guardian_recover'),
  prepareExit: (force) => operation('exit_prepare', { force }),
  preferences: () => operation('preferences'),
  setStartup: (enabled) => operation('startup_preference', { enabled }),
  history: (cursor) => operation('guardian_history', { cursor }),
};
export function createWorkbenchPreview(
  scenario: string,
  seedRuntime?: boolean,
  probes?: {
    environment: () => Promise<EnvironmentDetails>;
    browser: () => Promise<DailyBrowserDetails>;
  },
): WorkbenchService {
  const key = `codeseam-preview-workbench-${scenario}`;
  let record: WorkbenchRecord | null = null;
  const save = () => sessionStorage.setItem(key, JSON.stringify(record));
  return {
    async app(app, action) {
      record ??= await this.read();
      if (!record) throw new Error('请先完成初始化');
      const processes = record.observation?.processes;
      if (processes)
        processes[app] = {
          ...processes[app],
          count: action === 'start' ? 1 : 0,
          protection: 'uncovered',
        };
      save();
      return record;
    },
    async recover() {
      record ??= await this.read();
      if (!record) throw new Error('请先完成初始化');
      record.guardian = {
        state: 'unknown',
        at: new Date().toISOString(),
        error: '开发预览：未运行真实 Guardian',
      };
      save();
      return record;
    },
    async prepareExit() {
      return { stopped: true, remaining: [] };
    },
    async preferences() {
      return { startup: false, registered: false };
    },
    async history() {
      return {
        events: (await this.read())?.events.slice().reverse() ?? [],
        cursor: null,
      };
    },
    async setStartup(enabled) {
      return { startup: enabled, registered: false };
    },
    async reset(options) {
      if (!options.local && !options.virtual)
        throw new Error('请至少选择一个环境');
      if (scenario === 'reset-error')
        throw new Error('重置失败，原初始化记录已保留，请重试。');
      await new Promise((resolve) => setTimeout(resolve, 500));
      record = null;
      save();
      sessionStorage.setItem(key + '-reset', 'true');
      return {
        completed: true,
        backupPath: options.keepBackup ? '界面预览：未创建真实备份' : null,
      };
    },
    async read() {
      record = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      if (
        !record &&
        seedRuntime !== undefined &&
        !sessionStorage.getItem(key + '-reset')
      ) {
        await this.confirm({
          alias: '',
          region: '',
          virtualRuntime: seedRuntime,
          browser: 'edge',
        });
      }
      return record;
    },
    async confirm(input) {
      if (scenario === 'error' || scenario === 'save-error')
        throw new Error('正式基线保存失败，请重试。');
      const previous = JSON.parse(
        sessionStorage.getItem(key) ?? 'null',
      ) as WorkbenchRecord | null;
      if (previous && !previous.reconfiguration)
        throw new Error('已有正式基线');
      if (
        previous?.reconfiguration &&
        input.virtualRuntime !== previous.reconfiguration.virtualRuntime
      )
        throw new Error('目标运行环境与切换选择不一致');
      const baseline = await createBrowserPreview(
        scenario === 'runtime' ? 'runtime' : 'default',
      ).confirm(input.virtualRuntime, input.browser);
      if (scenario.startsWith('nodes')) {
        Object.assign(baseline.profile, {
          nodeId: 'sg',
          nodeName: 'SG Base 01',
          timezone: 'Singapore Standard Time',
          targetTimezone: 'Asia/Singapore',
        });
        if (baseline.profile.verification) {
          baseline.profile.verification.exitIp = '103.135.22.18';
          baseline.profile.verification.observed.timezone = 'Asia/Singapore';
        }
      }
      record = {
        schema: 1,
        baselineVersion: previous ? (previous.baselineVersion ?? 1) + 1 : 1,
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
            message: '开发预览：未运行真实 Guardian，保护状态待验证',
            level: 'warning',
          },
        ],
      };
      save();
      return record;
    },
    async refresh(scope = 'all') {
      record ??= JSON.parse(sessionStorage.getItem(key) ?? 'null');
      if (!record || !probes) throw new Error('请先完成初始化');
      const at = new Date().toISOString();
      const observation = {
        at,
        runtime: null,
        processes: null,
        error: null,
        ...record.observation,
      };
      if (scope !== 'browser') {
        const environment = await probes.environment();
        Object.assign(observation, {
          at: environment.at,
          environment,
          error:
            environment.error ??
            (scenario === 'refresh-error'
              ? '当前出口无法复验，请检查节点连接'
              : null),
          processes: {
            web: { count: 0, installed: true },
            code: { count: 0, installed: false },
            desktop: { count: 0, installed: false },
          },
        });
      }
      if (scope !== 'runtime') {
        try {
          const { at, online, ...browserData } = await probes.browser();
          observation.browser = { at, online, browserData };
        } catch (error) {
          observation.browser = { at, online: false, error: String(error) };
        }
      }
      record = { ...record, observation };
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

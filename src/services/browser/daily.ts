import { commands, type Status } from '../../bindings/commands';
import { call } from '../../core/ipc/call';
import { networkChecks } from './model';
import type { BrowserResult } from './index';
import type { WorkbenchRecord } from '../workbench';

export interface DailyBrowserDetails {
  notice?: string;
  at: string;
  online: boolean;
  profile: BrowserResult['profile'] | null;
  installedVersion: string | null;
  profileExists: boolean;
  shortcutValid: boolean;
  lastLaunched: string | null;
  baselineMatches: boolean;
  checks: { id: string; title: string; value: string; status: Status }[];
  error: string | null;
}
export type DailyBrowserAction = 'open' | 'verify' | 'recreate';
export interface DailyBrowserService {
  read(): Promise<DailyBrowserDetails>;
  run(action: DailyBrowserAction): Promise<void>;
}
async function operation<T>(action: string): Promise<T> {
  return call('workbench_operation', async () => {
    const result = await commands.workbenchOperation(`browser_${action}`, '{}');
    if (result.status === 'error') throw result.error;
    return JSON.parse(result.data) as T;
  });
}
export interface BrowserSnapshot {
  notice?: string;
  at: string;
  online: boolean;
  browserData?: Partial<
    Omit<DailyBrowserDetails, 'at' | 'online' | 'checks'>
  > | null;
  error?: string | null;
}
export function browserDetails(result: BrowserSnapshot): DailyBrowserDetails {
  const data = result.browserData;
  return {
    at: result.at,
    notice: result.notice,
    online: result.online,
    profile: result.online ? (data?.profile ?? null) : null,
    installedVersion: data?.installedVersion ?? null,
    profileExists: data?.profileExists ?? false,
    shortcutValid: data?.shortcutValid ?? false,
    lastLaunched: data?.lastLaunched ?? null,
    baselineMatches: data?.baselineMatches ?? false,
    checks: data?.profile
      ? networkChecks(data.profile, result.online && !!data.baselineMatches)
      : [],
    error: result.error ?? data?.error ?? null,
  };
}
export const nativeDailyBrowser: DailyBrowserService = {
  read: async () => browserDetails(await operation<BrowserSnapshot>('details')),
  async run(action) {
    const result = await operation<{ busy?: boolean }>(action);
    if (result.busy)
      throw new Error('专用浏览器正在使用此配置，请关闭窗口后运行验证。');
  },
};
export function createDailyBrowserPreview(
  readRecord: () => Promise<WorkbenchRecord | null>,
  scenario: string,
): DailyBrowserService {
  let lastLaunched: string | null = '2026-11-24T13:20:00Z';
  let checkedAt = '2026-11-24T13:35:00Z';
  let recreated = false;
  return {
    async read() {
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (scenario === 'browser-error')
        throw new Error('无法读取专用浏览器配置，请重新检测。');
      const record = await readRecord();
      if (!record) throw new Error('请先完成初始化');
      const p = structuredClone(record.baseline.profile);
      const failed = scenario === 'browser-failure';
      const offline = scenario === 'browser-offline';
      const empty = scenario === 'browser-empty' && !recreated;
      p.browserId = 'chrome';
      p.browserName = 'Google Chrome';
      p.version = '148.0.0.0';
      p.compatibility.version = p.version;
      p.compatibility.stableVersion = p.version;
      p.profileName = 'Claude-Profile';
      p.profileId = record.virtualRuntime ? 'CS-VIRTUAL-001' : 'CS-NATIVE-001';
      p.nodeName = 'SG-01 · 新加坡';
      p.language = 'zh-CN';
      p.targetTimezone = 'Asia/Singapore';
      p.verificationError = failed
        ? '浏览器实际出口与所选节点不一致，请检查节点后重新验证。'
        : undefined;
      if (p.verification) {
        p.verification.ok = !failed;
        p.verification.measuredAt = checkedAt;
        p.verification.exitIp = '103.163.220.47';
        Object.assign(p.verification.observed, {
          timezone: 'Asia/Singapore',
          utcOffset: 'UTC+08',
          platform: 'Win32',
          languages: ['zh-CN', 'zh'],
          hardwareConcurrency: 8,
          deviceMemory: 8,
          devicePixelRatio: 1,
          webglRenderer: 'WebGL Renderer',
          webgpu: true,
          language: 'zh-CN',
          width: 1920,
          height: 1080,
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36',
        });
      }
      const values = [
        'SG-01 · 新加坡',
        '实际路径已验证',
        '无非预期公网候选',
        '受管路径已覆盖',
        '策略已验证',
        '未发现',
      ];
      return {
        at: new Date().toISOString(),
        online: !offline,
        profile: offline || empty ? null : p,
        installedVersion: offline ? null : p.version,
        profileExists: !offline && !empty,
        shortcutValid:
          !offline && !empty && (scenario !== 'browser-shortcut' || recreated),
        lastLaunched,
        baselineMatches: !failed && !offline && !empty,
        checks: networkChecks(p, false).map((item, i) => ({
          ...item,
          value: empty
            ? 'Profile 未创建，待验证'
            : offline
              ? 'Runtime 未连接，待验证'
              : failed
                ? '检测未通过，请重新验证'
                : values[i],
          status:
            offline || empty ? 'unknown' : failed ? 'pending' : 'satisfied',
        })),
        error: offline
          ? '当前 Runtime 未连接，请先检查运行环境。'
          : (p.verificationError ?? null),
      };
    },
    async run(action) {
      await new Promise((resolve) => setTimeout(resolve, 650));
      if (
        scenario === 'browser-action-error' ||
        scenario === 'browser-failure' ||
        scenario === 'browser-offline'
      )
        throw new Error(
          '浏览器操作未完成，原 Profile 和登录状态已保留，请检查运行环境后重试。',
        );
      if (action === 'open') lastLaunched = new Date().toISOString();
      else checkedAt = new Date().toISOString();
      if (action === 'recreate') recreated = true;
    },
  };
}

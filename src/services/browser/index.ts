import { commands } from '../../bindings/commands';
import { call } from '../../core/ipc/call';
import { browserReady } from './model';
export { browserReady } from './model';
export interface BrowserResult {
  profile: {
    profileId: string;
    profileName: string;
    profilePath: string;
    browserId: string;
    browserName: string;
    executable: string;
    version: string;
    compatibility: {
      status: string;
      version: string;
      stableVersion: string;
      minimumMajor: number;
      updated: boolean;
      checkedAt: string;
    };
    runtime: string;
    nodeName: string;
    language: string;
    timezone: string;
    targetTimezone: string;
    timezoneStatus: string;
    proxyStatus: string;
    parametersStatus: string;
    shortcutStatus: string;
    verificationStatus: string;
    baselineStatus: string;
    baselinePath?: string;
    shortcutPath?: string;
    verificationError?: string;
    confirmed?: boolean;
    verification?: {
      ok: boolean;
      exitIp: string;
      measuredAt: string;
      observed: {
        origin: string;
        userAgent: string;
        language: string;
        timezone: string;
        width: number;
        height: number;
        canvas: boolean;
        webgl: boolean;
        audioSampleRate: number | null;
        permissions: Record<string, string>;
      };
      network: { dns: string; quic: string; webrtc: string; ipv6: string };
    };
  };
  available: { id: string; name: string; version: string }[];
  reused: boolean;
}
export interface BrowserService {
  prepare(virtualRuntime: boolean, browser?: string): Promise<BrowserResult>;
  confirm(virtualRuntime: boolean, browser: string): Promise<BrowserResult>;
  open(virtualRuntime: boolean, browser: string): Promise<void>;
  entry(
    virtualRuntime: boolean,
    browser: string,
    app: 'code' | 'desktop',
  ): Promise<void>;
  inspect(virtualRuntime: boolean, browser: string): Promise<void>;
}
async function action(
  virtualRuntime: boolean,
  browser: string,
  operation: string,
) {
  return call('browser_action', async () => {
    const result = await commands.browserAction(
      virtualRuntime,
      browser,
      operation,
    );
    if (result.status === 'error') throw result.error;
    return JSON.parse(result.data);
  });
}
export const nativeBrowser: BrowserService = {
  entry: async (virtualRuntime, browser, app) => {
    await action(virtualRuntime, browser, `install_${app}`);
  },
  confirm: (virtualRuntime, browser) =>
    action(virtualRuntime, browser, 'confirm'),
  open: async (virtualRuntime, browser) => {
    await action(virtualRuntime, browser, 'open');
  },
  inspect: async (virtualRuntime, browser) => {
    await action(virtualRuntime, browser, 'inspect');
  },
  prepare: (virtualRuntime, browser = '') =>
    call('prepare_browser', async () => {
      const result = await commands.prepareBrowser(virtualRuntime, browser);
      if (result.status === 'error') throw result.error;
      return JSON.parse(result.data) as BrowserResult;
    }),
};
export function createBrowserPreview(scenario: string): BrowserService {
  let reused = false;
  return {
    async entry() {
      await new Promise((resolve) => setTimeout(resolve, 100));
    },
    async confirm(virtualRuntime, browser) {
      const result = await this.prepare(virtualRuntime, browser);
      if (!browserReady(result.profile)) throw new Error('浏览器验证尚未通过');
      result.profile.confirmed = true;
      return result;
    },
    async open() {
      await new Promise((resolve) => setTimeout(resolve, 100));
    },
    async inspect() {
      await new Promise((resolve) => setTimeout(resolve, 100));
    },
    async prepare(virtualRuntime, browser = 'edge') {
      browser ||= 'edge';
      await new Promise((resolve) => setTimeout(resolve, 650));
      if (scenario === 'error' || scenario === 'empty')
        throw new Error('未发现可用浏览器，请安装 Chrome / Edge 后重新检测。');
      const result: BrowserResult = {
        profile: {
          profileId: `${virtualRuntime ? 'guest-demo' : 'native'}-${browser}`,
          profileName: 'Claude (CodeSeam)',
          profilePath: `CodeSeam/Browser/${virtualRuntime ? 'guest-demo' : 'native'}/${browser}/User Data`,
          browserId: browser,
          browserName:
            browser === 'chrome' ? 'Google Chrome' : 'Microsoft Edge',
          executable: '开发预览 · 浏览器路径',
          version: '开发预览',
          compatibility: {
            status: 'satisfied',
            version: '开发预览',
            stableVersion: '开发预览',
            minimumMajor: 1,
            updated: false,
            checkedAt: '开发预览',
          },
          runtime: virtualRuntime ? 'Virtual' : 'Native',
          nodeName: 'US-West-01',
          language: 'en-US',
          timezone: 'Pacific Standard Time',
          targetTimezone: 'America/Los_Angeles',
          timezoneStatus: 'satisfied',
          proxyStatus: 'satisfied',
          parametersStatus: 'satisfied',
          shortcutStatus: 'satisfied',
          verificationStatus: scenario === 'failure' ? 'pending' : 'satisfied',
          baselineStatus: scenario === 'failure' ? 'pending' : 'satisfied',
          baselinePath: '开发预览/browser-baseline.json',
          shortcutPath: '开发预览/Claude (CodeSeam).lnk',
          verificationError:
            scenario === 'failure'
              ? '浏览器出口与所选节点不一致，请重新测试节点。'
              : undefined,
          verification: {
            ok: scenario !== 'failure',
            exitIp: '203.0.113.10',
            measuredAt: '开发预览',
            observed: {
              origin: 'https://www.cloudflare.com',
              userAgent: '开发预览',
              language: 'en-US',
              timezone: 'America/Los_Angeles',
              width: 1280,
              height: 720,
              canvas: true,
              webgl: true,
              audioSampleRate: 48000,
              permissions: {
                camera: 'prompt',
                microphone: 'prompt',
                geolocation: 'prompt',
              },
            },
            network: {
              dns: '受管 DNS',
              quic: '已禁用',
              webrtc: '无非代理 ICE 候选',
              ipv6: '运行环境策略',
            },
          },
        },
        available: [
          { id: 'edge', name: 'Microsoft Edge', version: '开发预览' },
          { id: 'chrome', name: 'Google Chrome', version: '开发预览' },
        ],
        reused,
      };
      reused = true;
      return result;
    },
  };
}

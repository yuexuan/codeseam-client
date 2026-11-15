import { commands } from '../../bindings/commands';
import { call } from '../../core/ipc/call';
export interface BrowserResult {
  profile: {
    profileId: string;
    profileName: string;
    profilePath: string;
    browserId: string;
    browserName: string;
    executable: string;
    version: string;
    runtime: string;
    nodeName: string;
    language: string;
    timezone: string;
  };
  available: { id: string; name: string; version: string }[];
  reused: boolean;
}
export interface BrowserService {
  prepare(virtualRuntime: boolean, browser?: string): Promise<BrowserResult>;
}
export const nativeBrowser: BrowserService = {
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
          runtime: virtualRuntime ? 'Virtual' : 'Native',
          nodeName: 'US-West-01',
          language: 'en-US',
          timezone: 'Pacific Standard Time',
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

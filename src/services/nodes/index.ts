import { listen } from '@tauri-apps/api/event';
import {
  commands,
  type GeneralProxy,
  type NodeSnapshot,
  type ImportResult,
} from '../../bindings/commands';
import { call } from '../../core/ipc/call';
export type ProxyProtocol = 'socks5' | 'http' | 'https';
export async function checkKernelRelease(): Promise<{ version: string }> {
  const response = await fetch(
    'https://api.github.com/repos/MetaCubeX/mihomo/releases/latest',
    {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error('无法检查 Mihomo 更新，请稍后重试');
  const release: { tag_name?: string } = await response.json();
  if (!release.tag_name || !/^v\d+\.\d+\.\d+$/.test(release.tag_name))
    throw new Error('未获取到有效的 Mihomo 稳定版本');
  return { version: release.tag_name };
}
export interface NodesService {
  subscribe?(listener: (snapshot: NodeSnapshot) => void): Promise<() => void>;
  read(): Promise<NodeSnapshot>;
  importLinks(links: string): Promise<ImportResult>;
  importProxy(proxy: GeneralProxy): Promise<ImportResult>;
  select(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  test(ids: string[]): Promise<void>;
}
export const nativeNodes: NodesService = {
  subscribe: (listener) =>
    listen<NodeSnapshot>('nodes-progress', (event) => listener(event.payload)),
  read: () =>
    call('read_nodes', async () => {
      const result = await commands.readNodes();
      if (result.status === 'error') throw result.error;
      return result.data;
    }),
  importLinks: (links) =>
    call('import_nodes', async () => {
      const result = await commands.importNodes(links);
      if (result.status === 'error') throw result.error;
      return result.data;
    }),
  importProxy: (proxy) =>
    call('import_proxy', async () => {
      const result = await commands.importProxy(proxy);
      if (result.status === 'error') throw result.error;
      return result.data;
    }),
  select: (id) =>
    call('select_node', async () => {
      const result = await commands.selectNode(id);
      if (result.status === 'error') throw result.error;
    }),
  remove: (id) =>
    call('remove_node', async () => {
      const result = await commands.removeNode(id);
      if (result.status === 'error') throw result.error;
    }),
  clear: () =>
    call('clear_nodes', async () => {
      const result = await commands.clearNodes();
      if (result.status === 'error') throw result.error;
    }),
  test: (ids) =>
    call('test_nodes', async () => {
      const result = await commands.testNodes(ids);
      if (result.status === 'error') throw result.error;
    }),
};

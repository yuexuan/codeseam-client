import { listen } from '@tauri-apps/api/event';
import {
  commands,
  type GeneralProxy,
  type NodeSnapshot,
  type ImportResult,
} from '../../bindings/commands';
import { call } from '../../core/ipc/call';
export type ProxyProtocol = 'socks5' | 'http' | 'https';
export interface NodesService {
  subscribe?(listener: (snapshot: NodeSnapshot) => void): Promise<() => void>;
  read(): Promise<NodeSnapshot>;
  importLinks(links: string): Promise<ImportResult>;
  importProxy(proxy: GeneralProxy): Promise<ImportResult>;
  select(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  test(): Promise<void>;
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
  test: () =>
    call('test_nodes', async () => {
      const result = await commands.testNodes();
      if (result.status === 'error') throw result.error;
    }),
};

import type { NodeSnapshot, NodeSummary } from '../../bindings/commands';
import type { NodesService } from './index';

const examples: NodeSummary[] = [
  {
    id: 'sg',
    name: 'SG Base 01',
    protocol: 'vless',
    region: '新加坡',
    countryCode: 'sg',
    latency: 68,
    exitIp: '103.135.22.18',
    status: 'connected',
    error: null,
  },
  {
    id: 'sg-backup-1',
    name: 'SG Backup 01',
    protocol: 'vless',
    region: '新加坡',
    countryCode: 'sg',
    latency: 82,
    exitIp: '192.0.2.82',
    status: 'connected',
    error: null,
  },
  {
    id: 'sg-backup-2',
    name: 'SG Backup 02',
    protocol: 'vmess',
    region: '新加坡',
    countryCode: 'sg',
    latency: 95,
    exitIp: '192.0.2.96',
    status: 'connected',
    error: null,
  },
  {
    id: 'hk',
    name: 'HK Transit 01',
    protocol: 'trojan',
    region: '香港',
    countryCode: 'hk',
    latency: 42,
    exitIp: '192.0.2.42',
    status: 'connected',
    error: null,
  },
  {
    id: 'us',
    name: 'US West 01',
    protocol: 'ss',
    region: '美国',
    countryCode: 'us',
    latency: 189,
    exitIp: '192.0.2.189',
    status: 'connected',
    error: null,
  },
  {
    id: 'jp',
    name: 'JP Edge 01',
    protocol: 'vmess',
    region: '日本',
    countryCode: 'jp',
    latency: 95,
    exitIp: '192.0.2.95',
    status: 'connected',
    error: null,
  },
];
export function createNodesPreview(scenario: string): NodesService {
  let nodes = scenario === 'empty' ? [] : structuredClone(examples);
  let selectedId: string | null = scenario === 'empty' ? null : 'sg';
  if (['node-failure', 'node-repair-error'].includes(scenario) && nodes[0]) {
    Object.assign(nodes[0], {
      status: 'failed',
      exitIp: null,
      latency: null,
      region: null,
      error: '当前节点连接超时，请切换节点。',
    });
  }
  const wait = () => new Promise((resolve) => setTimeout(resolve, 500));
  const add = (name: string, protocol: string) => {
    nodes.push({
      id: crypto.randomUUID(),
      name,
      protocol,
      region: null,
      countryCode: null,
      latency: null,
      exitIp: null,
      status: 'untested',
      error: null,
    });
  };
  const identities = new Set<string>();
  const listeners = new Set<(snapshot: NodeSnapshot) => void>();
  let running = scenario !== 'service-failure';
  const snapshot = (): NodeSnapshot => ({
    nodes: structuredClone(nodes),
    selectedId,
    runtime: { running, version: 'v1.19.34' },
  });
  const publish = () => listeners.forEach((listener) => listener(snapshot()));
  return {
    subscribe: async (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read: async (): Promise<NodeSnapshot> => snapshot(),
    importLinks: async (links) => {
      await wait();
      if (!links) throw new Error('请粘贴订阅链接或节点链接');
      const list = links.split(/\s+/).map((line) => {
        try {
          return new URL(line);
        } catch {
          throw new Error('暂不支持此链接格式');
        }
      });
      if (
        list.some(
          (url) =>
            !['https:', 'http:', 'ss:', 'vmess:', 'vless:', 'trojan:'].includes(
              url.protocol,
            ),
        )
      )
        throw new Error('暂不支持此链接格式');
      if (list.some((url) => ['http:', 'https:'].includes(url.protocol)))
        throw new Error('开发预览无法获取真实订阅，请在桌面应用中导入');
      let added = 0;
      let duplicates = 0;
      list.forEach((url) => {
        const name = url.hash
          ? decodeURIComponent(url.hash.slice(1))
          : '导入节点';
        url.hash = '';
        const key = url.toString();
        if (identities.has(key)) {
          duplicates++;
          return;
        }
        identities.add(key);
        add(name, url.protocol.replace(':', ''));
        added++;
      });
      return { added, duplicates };
    },
    importProxy: async (proxy) => {
      await wait();
      const key = JSON.stringify(proxy);
      if (identities.has(key)) return { added: 0, duplicates: 1 };
      identities.add(key);
      add(`${proxy.server}:${proxy.port}`, proxy.protocol);
      return { added: 1, duplicates: 0 };
    },
    select: async (id) => {
      selectedId = id;
    },
    remove: async (id) => {
      nodes = nodes.filter((node) => node.id !== id);
      if (selectedId === id) selectedId = null;
    },
    clear: async () => {
      nodes = [];
      selectedId = null;
      identities.clear();
    },
    test: async (ids) => {
      if (scenario === 'service-failure') throw new Error('代理服务暂不可用');
      running = true;
      nodes = nodes.map((node) =>
        ids.includes(node.id)
          ? {
              ...node,
              status: 'queued',
              latency: null,
              region: null,
              countryCode: null,
              exitIp: null,
              error: null,
            }
          : node,
      );
      publish();
      for (let start = 0; start < ids.length; start += 8) {
        const batch = ids.slice(start, start + 8);
        nodes.forEach((node) => {
          if (batch.includes(node.id)) node.status = 'testing';
        });
        publish();
        await wait();
        nodes.forEach((node) => {
          if (!batch.includes(node.id)) return;
          const failed = scenario === 'test-failure';
          const example = examples.find((item) => item.id === node.id);
          Object.assign(node, {
            latency: failed ? null : (example?.latency ?? 380),
            exitIp: failed ? null : (example?.exitIp ?? '192.0.2.1'),
            region: failed ? null : (example?.region ?? '日本'),
            countryCode: failed ? null : (example?.countryCode ?? 'jp'),
            status: failed ? 'failed' : 'connected',
            error: failed ? '出口检测超时，请检查节点连通性' : null,
          });
        });
        publish();
      }
      running = true;
      publish();
    },
  };
}

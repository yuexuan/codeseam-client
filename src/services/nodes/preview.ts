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
  },
];
export function createNodesPreview(scenario: string): NodesService {
  let nodes = scenario === 'empty' ? [] : structuredClone(examples);
  let selectedId: string | null = scenario === 'empty' ? null : 'sg';
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
    });
  };
  const identities = new Set<string>();
  return {
    read: async (): Promise<NodeSnapshot> => ({
      nodes: structuredClone(nodes),
      selectedId,
      runtime: {
        running: scenario !== 'service-failure',
        version: scenario === 'service-failure' ? null : 'v1.19.3',
      },
    }),
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
    test: async () => {
      await wait();
      if (scenario === 'service-failure') throw new Error('代理服务暂不可用');
      nodes = nodes.map((node) => ({
        ...node,
        latency: scenario === 'test-failure' ? null : (node.latency ?? 86),
        exitIp: scenario === 'test-failure' ? null : node.exitIp,
        status: scenario === 'test-failure' ? 'failed' : 'connected',
      }));
    },
  };
}

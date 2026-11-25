import type { RuntimeReport, Check } from '../../bindings/commands';
import type { RuntimeService } from './index';

// 仅由 App 在显式启用的开发预览模式下注入。
export function createRuntimePreview(): RuntimeService {
  const checks: Check[] = [
    ['exit', '代理出口', 'SG-01 · 103.163.220.47'],
    ['timezone', '系统时区', 'Singapore Standard Time'],
    ['language', '系统语言', 'English (United States)'],
    ['culture', '区域格式', 'English (United States)'],
    ['dns', 'DNS', '受管 DNS'],
    ['ipv6', 'IPv6', '已关闭'],
    ['time_sync', '时间同步', '已启用'],
  ].map(([id, label, value]) => ({
    id,
    label,
    value,
    group: 'runtime',
    status: 'satisfied',
    detail: '开发预览',
    source: '开发演示',
    blocking: false,
  }));
  const report = (): RuntimeReport => ({
    checks,
    node: {
      id: 'preview-sg',
      name: 'SG-01',
      protocol: 'ss',
      region: '新加坡',
      countryCode: 'SG',
      latency: 35,
      exitIp: '103.163.220.47',
      status: 'connected',
    },
    observedAt: String(Math.floor(Date.now() / 1000)),
    revision: 'preview-native',
    confirmed: true,
    ready: true,
    targetTimezone: 'Singapore Standard Time',
  });
  return {
    async read() {
      return report();
    },
    async confirm() {
      return report();
    },
    async applySetting() {
      return report();
    },
    async openSetting() {},
    async readCompatibility() {
      return [
        'cpu',
        'slat',
        'firmware',
        'memory',
        'disk',
        'windows',
        'hyperv',
        'admin',
        'reboot',
        'conflict',
      ].map((id) => ({
        id,
        label: id,
        value: '已就绪（演示）',
        group: 'runtime',
        status: 'satisfied',
        detail: '开发预览',
        source: '开发演示',
        blocking: false,
      }));
    },
  };
}

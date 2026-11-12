import type { Check, Report } from '../../bindings/commands';
import type { EnvironmentService } from './index';
const check = (
  id: string,
  group: Check['group'],
  label: string,
  value: string,
  status: Check['status'],
): Check => ({
  id,
  group,
  label,
  value,
  status,
  detail: '显式开发预览数据，不代表当前电脑检测结果。',
  source: '开发预览',
  blocking: false,
});
const checks: Check[] = [
  check('windows', 'system', 'Windows 版本', 'Windows 11 64 位', 'satisfied'),
  check(
    'timezone',
    'system',
    '系统时区',
    'Asia/Shanghai (UTC+08:00)',
    'satisfied',
  ),
  check('language', 'system', '语言', '简体中文', 'satisfied'),
  check('browser', 'apps', 'Claude Web 浏览器', '已安装 Chrome', 'satisfied'),
  check('code', 'apps', 'Claude Code', '尚未安装', 'pending'),
  check('desktop', 'apps', 'Claude Desktop', '尚未验证', 'unknown'),
  check('connection', 'network', '网络连接', '系统报告可用', 'satisfied'),
  check('nodes', 'network', '代理节点', '未配置', 'pending'),
  check('proxy', 'network', '代理服务', '尚未发现', 'pending'),
  check('hyperv', 'runtime', 'Hyper-V', '尚未启用', 'optional'),
];
export function createPreview(scenario: string): EnvironmentService {
  let scans = 0;
  return {
    readStartup: async () => ({
      schema: 1,
      scanPhase: scenario === 'interrupted' ? 'interrupted' : 'not_started',
      lastObservedAt: null,
      recovery:
        scenario === 'recovery'
          ? [{ message: 'Claude Code 有待恢复的受管配置', action: 'cli' }]
          : [],
    }),
    scan: async (): Promise<Report> => {
      scans += 1;
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (
        scenario === 'failure' ||
        (scenario === 'refresh-failure' && scans > 1)
      )
        throw new Error('预览：系统检测进程未返回有效结果');
      return {
        checks: checks.map((item) =>
          scenario === 'partial' && item.id === 'timezone'
            ? {
                ...item,
                status: 'unknown',
                value: '无法读取',
                detail: '预览：权限不足',
              }
            : item,
        ),
        observedAt: String(Math.floor(Date.now() / 1000)),
      };
    },
    restore: async () => {
      throw new Error('预览不会执行真实恢复');
    },
  };
}

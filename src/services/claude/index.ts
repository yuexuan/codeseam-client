import { commands, type CleanupReport } from '../../bindings/commands';
import { virtualOperation } from '../runtime/virtual';
import { call } from '../../core/ipc/call';
export type CleanupAction = 'scan' | 'clean' | 'restore';
export interface ClaudeService {
  run(action: CleanupAction, ids?: string[]): Promise<CleanupReport>;
}
export const nativeClaude: ClaudeService = {
  run: (action, ids = []) =>
    call('claude_cleanup', async () => {
      const result = await commands.claudeCleanup(action, ids);
      if (result.status === 'error') throw result.error;
      return result.data;
    }),
};
export function createClaudePreview(scenario: string): ClaudeService {
  const initial =
    scenario === 'empty'
      ? []
      : [
          {
            id: 'code',
            label: 'Claude Code · 旧连接与代理变量',
            detail: '用户级配置 · 自定义服务端点与 Claude 专属代理变量',
          },
          {
            id: 'env',
            label: 'Claude Code · 代理环境变量',
            detail: 'Claude 专属变量 · 用户级',
          },
          {
            id: 'desktop',
            label: 'Claude Desktop · 旧网络设置',
            detail: '应用配置 · 代理覆盖项',
          },
        ];
  let items = [...initial];
  let backup = false;
  return {
    async run(action, ids = []) {
      await new Promise((resolve) =>
        setTimeout(resolve, action === 'scan' ? 300 : 1600),
      );
      if (scenario === 'error' && action === 'clean')
        throw new Error('备份校验失败，未清理；可以重试或跳过。');
      if (action === 'clean') {
        items = items.filter((item) => !ids.includes(item.id));
        backup = true;
      }
      if (action === 'restore') {
        items = [...initial];
        backup = false;
      }
      return {
        warnings: [],
        items,
        codeInstalled: scenario !== 'empty',
        desktopInstalled: scenario !== 'empty',
        canRestore: backup,
      };
    },
  };
}

export const virtualClaude: ClaudeService = {
  async run(action) {
    await virtualOperation('ensure_ready');
    if (action !== 'scan')
      throw new Error('Guest Claude 配置清理尚未接通，请跳过此步骤。');
    return {
      items: [],
      codeInstalled: false,
      desktopInstalled: false,
      canRestore: false,
      warnings: [
        '已连接虚拟机。Guest 内 Claude 配置扫描与清理尚未接通，请跳过此步骤；当前未扫描或清理宿主机配置。',
      ],
    };
  },
};

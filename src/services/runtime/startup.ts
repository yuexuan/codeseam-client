import type {
  EnvironmentDetails,
  RuntimeEnvironmentService,
} from './environment';
import type { WorkbenchService } from '../workbench';

export type StartupStage = 'runtime' | 'connection' | 'workspace';

function requireConnection(details: EnvironmentDetails) {
  if (!details.online || details.error)
    throw new Error(
      details.error || '运行环境尚未连接，请检查启动状态后重试。',
    );
  for (const [id, label] of [
    ['exit', '节点出口'],
    ['dns', 'DNS 连接'],
    ['browser', '专用浏览器配置'],
  ]) {
    const check = details.checks.find((item) => item.id === id);
    if (check?.status !== 'satisfied')
      throw new Error(
        `${label}尚未就绪：${check?.value || '未取得有效检测结果'}`,
      );
  }
}

// 仅最新证据可解锁工作区；初始化阶段的证据仅作历史记录。
export async function startWorkspace(
  environment: RuntimeEnvironmentService,
  workbench: WorkbenchService,
  onStage: (stage: StartupStage) => void,
) {
  onStage('runtime');
  await environment.start();
  onStage('connection');
  const record = await workbench.refresh();
  if (!record.observation?.environment || record.observation.error)
    throw new Error(
      record.observation?.error || '工作台状态读取未完成，请重试。',
    );
  requireConnection(record.observation.environment);
  onStage('workspace');
  const runtime = record.observation.runtime;
  if (runtime && (!runtime.ready || !runtime.confirmed))
    throw new Error('当前运行环境与正式基线不一致，请检查环境后重试。');
  return record;
}

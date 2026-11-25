import { commands, type Status } from '../../bindings/commands';
import { call } from '../../core/ipc/call';
import type { WorkbenchRecord } from '../workbench';
import type { NodesService } from '../nodes';
import { baselineNode, nodeAvailability } from '../nodes/model';

export interface EnvironmentDetails {
  at: string;
  name: string;
  state: string;
  online: boolean;
  system: string | null;
  language: string | null;
  timezone: string | null;
  platform: string;
  cpu: number | null;
  cpuUsage: number | null;
  memory: number | null;
  memoryAvailable: number | null;
  disk: number | null;
  diskAvailable: number | null;
  exitIp: string | null;
  checks: { id: string; value: string; status: Status; label: string }[];
  error: string | null;
}
export interface RuntimeEnvironmentService {
  start(): Promise<void>;
  stop(): Promise<void>;
  read(): Promise<EnvironmentDetails>;
  openConsole(): Promise<void>;
  repairNode(): Promise<WorkbenchRecord>;
  switchNode(id: string): Promise<WorkbenchRecord>;
  begin(virtualRuntime: boolean): Promise<WorkbenchRecord>;
  cancel(): Promise<WorkbenchRecord>;
}
async function operation<T>(action: string, payload: object = {}): Promise<T> {
  return call('workbench_operation', async () => {
    const result = await commands.workbenchOperation(
      action,
      JSON.stringify(payload),
    );
    if (result.status === 'error') throw result.error;
    return JSON.parse(result.data) as T;
  });
}
export const nativeRuntimeEnvironment: RuntimeEnvironmentService = {
  start: () => operation('runtime_start'),
  stop: () => operation('runtime_stop'),
  read: () => operation('runtime_details'),
  openConsole: () => operation('runtime_console'),
  repairNode: () => operation('node_repair'),
  switchNode: (id) => operation('node_switch', { id }),
  begin: (virtualRuntime) => operation('reconfigure_begin', { virtualRuntime }),
  cancel: () => operation('reconfigure_cancel'),
};

export function createRuntimeEnvironmentPreview(
  readRecord: () => Promise<WorkbenchRecord | null>,
  scenario: string,
  nodes?: NodesService,
): RuntimeEnvironmentService {
  let started = false;
  let stopped = false;
  let attempts = 0;
  let nodeRepaired = false;
  const update = async (virtualRuntime?: boolean) => {
    const record = await readRecord();
    if (!record) throw new Error('请先完成初始化');
    if (scenario === 'switch-error')
      throw new Error('备份未完成，当前正式环境已保留，请重试。');
    const updated = {
      ...record,
      reconfiguration:
        virtualRuntime === undefined
          ? null
          : {
              virtualRuntime,
              startedAt: new Date().toISOString(),
              backup: '开发预览：未创建真实备份',
            },
    };
    sessionStorage.setItem(
      `codeseam-preview-workbench-${scenario}`,
      JSON.stringify(updated),
    );
    return updated;
  };
  return {
    async switchNode(id) {
      if (!nodes) throw new Error('节点服务不可用');
      const record = await readRecord();
      if (!record) throw new Error('请先完成初始化');
      const snapshot = await nodes.read();
      const node = snapshot.nodes.find((item) => item.id === id);
      const current = baselineNode(record, snapshot.nodes);
      if (
        !node ||
        !nodeAvailability(node, current?.countryCode ?? null).selectable
      )
        throw new Error('仅可切换到测试通过的同国家节点');
      await nodes.select(id);
      const updated = await this.repairNode();
      updated.baseline.profile = {
        ...updated.baseline.profile,
        nodeId: node.id,
        nodeName: node.name,
        verification: updated.baseline.profile.verification
          ? {
              ...updated.baseline.profile.verification,
              exitIp: node.exitIp ?? '',
            }
          : undefined,
      };
      if (updated.runtime) updated.runtime = { ...updated.runtime, node };
      sessionStorage.setItem(
        `codeseam-preview-workbench-${scenario}`,
        JSON.stringify(updated),
      );
      return updated;
    },
    async start() {
      attempts++;
      await new Promise((resolve) =>
        setTimeout(resolve, scenario === 'startup-slow' ? 12000 : 1000),
      );
      if (
        scenario === 'startup-error' ||
        (scenario === 'startup-retry' && attempts === 1)
      )
        throw new Error(
          '虚拟机启动失败，请检查 Hyper-V 服务和可用内存后重试。',
        );
      started = true;
      stopped = false;
    },
    async stop() {
      await new Promise((resolve) => setTimeout(resolve, 500));
      stopped = true;
      started = false;
    },
    async read() {
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (scenario === 'runtime-error')
        throw new Error('无法连接 Hyper-V 管理接口，请重新检测。');
      const record = await readRecord();
      if (!record) throw new Error('请先完成初始化');
      const failed =
        !nodeRepaired &&
        ['failure', 'node-failure', 'node-repair-error'].includes(scenario);
      const offline = stopped || (scenario === 'runtime-offline' && !started);
      const virtual = record.virtualRuntime;
      return {
        at: new Date().toISOString(),
        name: virtual ? 'CodeSeam-VM01' : '本机 Windows',
        state: offline ? 'Off' : 'Running',
        online: !offline,
        system: offline ? null : 'Windows 10 x64 · 22H2',
        language: offline ? null : 'English (United States)',
        timezone: offline ? null : '亚洲/新加坡 · UTC+08:00',
        platform: virtual ? 'Hyper-V · 第 2 代' : 'Native · 当前 Windows 用户',
        cpu: 4,
        cpuUsage: offline ? null : 18,
        memory: 8,
        memoryAvailable: offline ? null : 4.9,
        disk: 80,
        diskAvailable: offline ? null : 37,
        exitIp: offline || failed ? null : '103.163.220.47',
        checks: [
          {
            id: 'exit',
            value: offline
              ? 'Guest 离线，当前出口待检测'
              : failed
                ? '当前出口无法复验'
                : 'SG-01 · 103.163.220.47',
            status: offline ? 'unknown' : failed ? 'pending' : 'satisfied',
            label: offline ? '待检测' : failed ? '复验失败' : '与基线一致',
          },
          {
            id: 'dns',
            value: offline ? 'Guest 离线，解析路径待检测' : '解析路径已验证',
            status: offline ? 'unknown' : 'satisfied',
            label: offline ? '待检测' : '正常',
          },
          {
            id: 'network',
            value: offline ? 'Guest 离线，网络策略待检测' : '未发现非预期直连',
            status: offline ? 'unknown' : 'satisfied',
            label: offline ? '待检测' : '正常',
          },
          {
            id: 'browser',
            value: offline
              ? 'Guest 离线，Profile 配置待复验'
              : virtual
                ? 'Guest Profile 与已确认配置一致'
                : '专用 Profile 与已确认配置一致',
            status: offline ? 'unknown' : 'satisfied',
            label: offline ? '待检测' : '配置一致',
          },
        ],
        error: null,
      };
    },
    async openConsole() {
      if (scenario === 'console-error')
        throw new Error('虚拟机窗口打开失败，请重试。');
    },
    async repairNode() {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (scenario === 'node-repair-error' || scenario === 'nodes-switch-error')
        throw new Error('节点出口复验失败，请切换其他节点后重试。');
      const record = await readRecord();
      if (!record) throw new Error('请先完成初始化');
      nodeRepaired = true;
      const updated = {
        ...record,
        confirmedAt: new Date().toISOString(),
        baselineVersion: (record.baselineVersion ?? 1) + 1,
      };
      sessionStorage.setItem(
        `codeseam-preview-workbench-${scenario}`,
        JSON.stringify(updated),
      );
      return updated;
    },
    begin: update,
    cancel: () => update(),
  };
}

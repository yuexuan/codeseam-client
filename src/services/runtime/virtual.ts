import { commands } from '../../bindings/commands';
import { call } from '../../core/ipc/call';
export interface VMConfig {
  name: string;
  iso: string;
  cpu: number;
  memory: number;
  disk: number;
  network: string;
}
export interface VMResources {
  hardware?: boolean;
  windows?: boolean;
  ready: boolean;
  reboot: boolean;
  enabled: boolean;
  cpu: number;
  memory: number;
  disk: number;
  switches: string[];
  checkpoint?: { phase: string; name: string; config: VMConfig };
}
export interface GuestStatus {
  startedAt?: string;
  stepStartedAt?: string;
  updatedAt?: string;
  activeIndex?: number;
  history?: { time: string; detail: string }[];
  desktopSetupVersion?: number;
  nodeName?: string;
  timezone?: string;
  language?: string;
  progress?: number;
  error?: string;
  tasks?: { status: string; detail: string }[];
  name: string;
  state: string;
  ready: boolean;
  detail: string;
}
export async function virtualOperation<T>(
  action: string,
  payload: object = {},
): Promise<T> {
  return call('virtual_operation', async () => {
    const result = await commands.virtualOperation(
      action,
      JSON.stringify(payload),
    );
    if (result.status === 'error') throw result.error;
    return JSON.parse(result.data) as T;
  });
}

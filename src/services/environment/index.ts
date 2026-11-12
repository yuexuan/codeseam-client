import type { Report, Startup, RecoveryAction } from '../../bindings/commands';
import { commands } from '../../bindings/commands';
import { call } from '../../core/ipc/call';
export interface EnvironmentService {
  readStartup(): Promise<Startup>;
  scan(): Promise<Report>;
  restore(action: RecoveryAction): Promise<void>;
}
export const nativeEnvironment: EnvironmentService = {
  readStartup: () =>
    call('read_startup', async () => {
      const result = await commands.readStartup();
      if (result.status === 'error') throw result.error;
      return result.data;
    }),
  scan: () =>
    call('scan_environment', async () => {
      const result = await commands.scanEnvironment();
      if (result.status === 'error') throw result.error;
      return result.data;
    }),
  restore: (action) =>
    call('restore_legacy', async () => {
      const result = await commands.restoreLegacy(action);
      if (result.status === 'error') throw result.error;
    }),
};

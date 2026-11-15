import {
  commands,
  type RuntimeReport,
  type RuntimeSetting,
  type Check,
} from '../../bindings/commands';
import { call } from '../../core/ipc/call';
export interface RuntimeService {
  readCompatibility(): Promise<Check[]>;
  read(): Promise<RuntimeReport>;
  confirm(revision: string): Promise<RuntimeReport>;
  applySetting(
    setting: RuntimeSetting,
    revision: string,
    target?: string,
  ): Promise<RuntimeReport>;
  openSetting(setting: RuntimeSetting): Promise<void>;
}
export const nativeRuntime: RuntimeService = {
  readCompatibility: () =>
    call('read_hyperv_compatibility', async () => {
      const result = await commands.readHypervCompatibility();
      if (result.status === 'error') throw result.error;
      return result.data;
    }),
  read: () =>
    call('read_runtime', async () => {
      const result = await commands.readRuntime();
      if (result.status === 'error') throw result.error;
      return result.data;
    }),
  confirm: (revision) =>
    call('confirm_native_runtime', async () => {
      const result = await commands.confirmNativeRuntime(revision);
      if (result.status === 'error') throw result.error;
      return result.data;
    }),
  applySetting: (setting, revision, target) =>
    call('apply_runtime_setting', async () => {
      const result = await commands.applyRuntimeSetting(
        setting,
        revision,
        target ?? null,
      );
      if (result.status === 'error') throw result.error;
      return result.data;
    }),
  openSetting: (setting) =>
    call('open_runtime_setting', async () => {
      const result = await commands.openRuntimeSetting(setting);
      if (result.status === 'error') throw result.error;
    }),
};

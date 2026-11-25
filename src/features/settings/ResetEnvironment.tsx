import { Checkbox } from '../../components/ui/Checkbox';
import { Radio } from '../../components/ui/Radio';
import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { SettingGroup, SettingRow } from '../../components/layout/SettingGroup';
import { DetailDialog } from '../../components/ui/DetailDialog';
import { Button } from '../../components/ui/Button';
import type { WorkbenchService, ResetResult } from '../../services/workbench';
import styles from './SettingsPage.module.css';

export function ResetEnvironment({
  service,
  virtualRuntime,
  preview,
  onReset,
}: {
  service: WorkbenchService;
  virtualRuntime: boolean;
  preview: boolean;
  onReset: () => void;
}) {
  const [show, setShow] = useState(false);
  const [local, setLocal] = useState(!virtualRuntime);
  const [virtual, setVirtual] = useState(virtualRuntime);
  const [keepBackup, setKeepBackup] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ResetResult>();
  const reset = async () => {
    if (busy || (!local && !virtual)) return;
    setBusy(true);
    setError('');
    try {
      const completed = await service.reset({ local, virtual, keepBackup });
      if (!completed.completed) throw new Error('重置尚未完成，请重试');
      setResult(completed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SettingGroup title="环境重置" icon={RotateCcw}>
        <SettingRow
          title="重置环境"
          description="选择本地或虚拟环境，重置后重新初始化。"
          onClick={() => setShow(true)}
        />
      </SettingGroup>
      {show && (
        <DetailDialog
          title={result ? '环境已重置' : '重置环境'}
          locked={busy}
          closeLabel={result ? '返回初始化' : busy ? '正在重置…' : '取消'}
          onClose={() => {
            if (busy) return;
            if (result) onReset();
            else setShow(false);
          }}
        >
          {result ? (
            <>
              <p>所选环境已重置，可以重新开始初始化。</p>
              <p>
                {result.backupPath
                  ? `备份位置：${result.backupPath}`
                  : '本次未保留新的重置备份。'}
              </p>
            </>
          ) : (
            <>
              <p className={styles.groupDescription}>
                请选择要重置的环境。专用浏览器将关闭，所选环境的数据将清除，正式初始化记录将移除。
              </p>
              {preview && (
                <p className={styles.pending}>
                  当前为开发预览，仅模拟重置，不修改系统或创建真实备份。
                </p>
              )}
              <fieldset className={styles.scope} disabled={busy}>
                <legend>重置范围（可多选）</legend>
                <label>
                  <Checkbox
                    checked={local}
                    onChange={(e) => setLocal(e.target.checked)}
                  />
                  本地环境
                </label>
                <label>
                  <Checkbox
                    checked={virtual}
                    onChange={(e) => setVirtual(e.target.checked)}
                  />
                  虚拟环境
                </label>
              </fieldset>
              <p className={styles.note}>
                本地：清除专用浏览器与快捷方式，恢复受管系统设置和清理前配置。虚拟：关闭并删除受管
                Hyper-V
                虚拟机与磁盘。节点列表、其他环境与安装镜像保留。无论选择哪项，完成后均需重新初始化。
              </p>
              <fieldset className={styles.scope} disabled={busy}>
                <legend>重置前是否保留备份？</legend>
                <label>
                  <Radio
                    name="reset-backup"
                    checked={keepBackup}
                    onChange={() => setKeepBackup(true)}
                  />
                  保留备份（推荐）
                </label>
                <label>
                  <Radio
                    name="reset-backup"
                    checked={!keepBackup}
                    onChange={() => setKeepBackup(false)}
                  />
                  不保留备份
                </label>
              </fieldset>
              <p className={styles.note}>
                {keepBackup
                  ? '先备份再清除。虚拟机使用 Hyper-V 导出，可能需要较长时间和较多磁盘空间。备份保存在本机 CodeSeam 数据目录，包含浏览器登录数据，请妥善保管。'
                  : '不创建新的重置备份。清除的数据无法通过此次操作恢复，已有历史备份仍保留。'}
              </p>
              {error && <p role="alert">{error}</p>}
              <div className={styles.dialogActions}>
                <Button
                  variant="primary"
                  disabled={busy || (!local && !virtual)}
                  onClick={() => void reset()}
                >
                  {busy ? '正在重置，请勿退出…' : '确认重置环境'}
                </Button>
              </div>
              {busy && (
                <p role="status">正在处理所选环境，完成后可返回初始化。</p>
              )}
            </>
          )}
        </DetailDialog>
      )}
    </>
  );
}

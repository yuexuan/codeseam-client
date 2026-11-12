import { useEffect, useRef } from 'react';
import { Button } from './Button';
import styles from './DecisionDialog.module.css';
export function DecisionDialog({
  kind,
  onCancel,
  onConfirm,
}: {
  kind: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) throw new Error('确认窗口尚未挂载');
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="restore-title"
      onCancel={onCancel}
      className={styles.dialog}
    >
      <h2 id="restore-title">确认恢复旧配置</h2>
      <p>
        将根据现有备份恢复
        {kind === 'cli' ? ' Claude Code 的受管字段' : '系统网络设置'}
        。若发现外部修改或冲突，操作会停止并保留备份。
      </p>
      <div>
        <Button autoFocus onClick={onCancel}>
          取消
        </Button>
        <Button onClick={onConfirm}>确认恢复</Button>
      </div>
    </dialog>
  );
}

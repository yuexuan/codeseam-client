import { Dialog } from '../../components/ui/Dialog';
import { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { LoaderCircle, RefreshCw, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import type { NodesService } from '../../services/nodes';
import type { WorkbenchRecord } from '../../services/workbench';
import { NodeEditor } from './NodeEditor';
import styles from './NodeEditorDialog.module.css';

export function NodeEditorDialog({
  service,
  apply,
  onApplied,
  onClose,
  closeLabel = '返回启动页',
}: {
  service: NodesService;
  apply: () => Promise<WorkbenchRecord>;
  onApplied: (record: WorkbenchRecord) => void;
  onClose: () => void;
  closeLabel?: string;
}) {
  const titleId = useId();
  const [editor, setEditor] = useState({ ready: false, busy: true });
  const application = useMutation({ mutationFn: apply, onSuccess: onApplied });
  const locked = editor.busy || application.isPending;
  return (
    <Dialog
      onDismiss={onClose}
      locked={locked}
      className={styles.dialog}
      aria-labelledby={titleId}
    >
      <header className={styles.header}>
        <div>
          <h2 id={titleId}>编辑节点与代理</h2>
          <p>
            添加或切换节点，测试通过后应用到当前环境。应用时将关闭专用浏览器，保留登录数据。
          </p>
        </div>
        <button
          autoFocus
          aria-label="关闭节点编辑"
          disabled={locked}
          onClick={onClose}
        >
          <X size={22} />
        </button>
      </header>
      <div className={styles.editor} inert={application.isPending}>
        <NodeEditor service={service} onStateChange={setEditor} />
      </div>
      <footer className={styles.footer}>
        <div
          role={application.isError ? 'alert' : 'status'}
          className={application.isError ? styles.error : undefined}
        >
          {application.error?.message ??
            (application.isPending
              ? '正在应用节点并复验出口、时区与专用浏览器，请稍候…'
              : editor.ready
                ? '所选节点测试通过，可以应用。'
                : '请选择节点并完成连接测试。')}
        </div>
        <div className={styles.actions}>
          <Button disabled={locked} onClick={onClose}>
            {closeLabel}
          </Button>
          <Button
            variant="primary"
            disabled={locked || !editor.ready}
            onClick={() => application.mutate()}
          >
            {application.isPending ? (
              <LoaderCircle size={18} className={styles.spinning} />
            ) : (
              <RefreshCw size={18} />
            )}
            {application.isPending ? '正在应用…' : '应用并重新检测'}
          </Button>
        </div>
      </footer>
    </Dialog>
  );
}

import { Dialog } from './Dialog';
import { useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import styles from './DetailDialog.module.css';

export function DetailDialog({
  title,
  children,
  onClose,
  closeLabel = '关闭',
  locked = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  closeLabel?: string;
  locked?: boolean;
}) {
  const titleId = useId();
  return (
    <Dialog
      onDismiss={onClose}
      locked={locked}
      className={styles.dialog}
      aria-labelledby={titleId}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          autoFocus
          disabled={locked}
          onClick={onClose}
          aria-label="关闭详情"
        >
          <X />
        </button>
      </header>
      {children}
      <Button disabled={locked} onClick={onClose}>
        {closeLabel}
      </Button>
    </Dialog>
  );
}

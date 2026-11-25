import { Minus, Square, X } from 'lucide-react';
import styles from './WindowActions.module.css';

export function WindowActions({
  onMinimize,
  onMaximize,
  onClose,
}: {
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
}) {
  return (
    <div className={styles.controls}>
      <button type="button" aria-label="最小化" onClick={onMinimize}>
        <Minus size={18} />
      </button>
      <button type="button" aria-label="最大化或还原" onClick={onMaximize}>
        <Square size={16} />
      </button>
      <button
        type="button"
        aria-label="关闭"
        className={styles.close}
        onClick={onClose}
      >
        <X size={20} />
      </button>
    </div>
  );
}

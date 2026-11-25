import { useEffect, useRef, type DialogHTMLAttributes } from 'react';
import styles from './Dialog.module.css';

type Props = Omit<
  DialogHTMLAttributes<HTMLDialogElement>,
  'open' | 'onCancel'
> & {
  onDismiss: () => void;
  locked?: boolean;
};

/** 挂载后打开；关闭时由调用方卸载，焦点管理由原生对话框负责。 */
export function Dialog({
  onDismiss,
  locked = false,
  className = '',
  ...props
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <dialog
      {...props}
      ref={ref}
      className={`${styles.dialog} ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onDismiss();
      }}
    />
  );
}

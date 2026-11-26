import { Info, Layers, Monitor, X } from 'lucide-react';
import { useId } from 'react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Radio } from '../../components/ui/Radio';
import styles from './ReconfigureDialog.module.css';

type Props = {
  virtual: boolean;
  target: boolean;
  onSelect: (virtual: boolean) => void;
  pending: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
};

export function ReconfigureDialog({
  virtual,
  target,
  onSelect,
  pending,
  error,
  onClose,
  onConfirm,
}: Props) {
  const titleId = useId();
  return (
    <Dialog
      className={styles.dialog}
      aria-labelledby={titleId}
      locked={pending}
      onDismiss={onClose}
    >
      <header className={styles.header}>
        <div>
          <h2 id={titleId}>重新配置运行环境</h2>
          <p>
            当前环境 · {virtual ? 'Virtual 独立虚拟环境' : 'Native 本机运行'}
          </p>
        </div>
        <Button
          className={styles.close}
          aria-label="关闭"
          disabled={pending}
          onClick={onClose}
        >
          <X size={18} />
        </Button>
      </header>
      <div className={styles.body}>
        <fieldset disabled={pending} className={styles.options}>
          <legend>选择处理方式</legend>
          {[virtual, !virtual].map((isVirtual) => {
            const Icon = isVirtual ? Layers : Monitor;
            const name = isVirtual ? 'Virtual' : 'Native';
            return (
              <label className={styles.option} key={name}>
                <span className={styles.icon}>
                  <Icon size={20} aria-hidden="true" />
                </span>
                <span className={styles.copy}>
                  <strong>
                    {isVirtual === virtual
                      ? '重新验证当前环境'
                      : '切换运行环境'}
                  </strong>
                  <small>
                    {name} · {isVirtual ? '独立虚拟环境' : '本机运行'}
                  </small>
                </span>
                <Radio
                  name="target-runtime"
                  value={name}
                  checked={target === isVirtual}
                  onChange={() => onSelect(isVirtual)}
                />
              </label>
            );
          })}
        </fieldset>
        <aside className={styles.note}>
          <Info size={17} aria-hidden="true" />
          <div>
            <strong>请先保存工作</strong>
            <p>
              运行中的受管 Claude
              应用将关闭。系统会先备份配置，再准备目标环境。登录状态不会自动迁移。
            </p>
            <p>
              验证通过并确认新基线后，配置才会生效。现有虚拟机、Profile
              和历史基线均会保留。
            </p>
          </div>
        </aside>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </div>
      <footer className={styles.footer}>
        <Button disabled={pending} onClick={onClose}>
          取消
        </Button>
        <Button variant="primary" disabled={pending} onClick={onConfirm}>
          {pending ? '正在备份并准备环境…' : '开始重新配置'}
        </Button>
      </footer>
    </Dialog>
  );
}

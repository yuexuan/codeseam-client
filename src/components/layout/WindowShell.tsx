import { WizardFooterContext } from './WizardActions';
import { useState, type ReactNode } from 'react';
import { Check, Minus, Square, X } from 'lucide-react';
import type { WindowControls } from '../../core/platform/window';
import logo from '../../assets/codeseam-logo.svg';
import styles from './WindowShell.module.css';
const steps = [
  '环境预检',
  '节点与代理',
  'Claude 应用',
  '运行环境',
  '浏览器',
  '确认完成',
];
export function WindowShell({
  children,
  footer,
  window,
  preview,
  step = 0,
  virtualRuntime = false,
}: {
  children: ReactNode;
  footer: ReactNode;
  window: WindowControls;
  preview: boolean;
  step?: number;
  virtualRuntime?: boolean;
}) {
  const [error, setError] = useState('');
  const visibleSteps = steps;
  const visibleStep = step;
  const [footerHost, setFooterHost] = useState<HTMLElement | null>(null);
  const act = (action: () => Promise<void>) => {
    void action().catch((e: Error) => setError(e.message));
  };
  return (
    <div
      className={`${styles.shell} ${step === 1 || step === 2 || step === 3 || step === 5 ? styles.nodesShell : ''} ${virtualRuntime ? styles.virtualShell : ''}`}
    >
      <header className={styles.titlebar} data-tauri-drag-region>
        <img src={logo} alt="CodeSeam" draggable={false} />
        <div className={styles.controls}>
          <button aria-label="最小化" onClick={() => act(window.minimize)}>
            <Minus size={18} />
          </button>
          <button
            aria-label="最大化或还原"
            onClick={() => act(window.maximize)}
          >
            <Square size={15} />
          </button>
          <button
            aria-label="关闭"
            className={styles.close}
            onClick={() => act(window.close)}
          >
            <X size={20} />
          </button>
        </div>
      </header>
      <nav aria-label="初始化步骤" className={styles.steps}>
        <ol>
          {visibleSteps.map((label, index) => (
            <li
              key={label}
              aria-current={index === visibleStep ? 'step' : undefined}
            >
              <span
                className={`${styles.number} ${index < visibleStep ? styles.done : ''}`}
              >
                {index < visibleStep ? (
                  <Check size={21} aria-label="已完成" />
                ) : (
                  index + 1
                )}
              </span>
              <span>{label}</span>
            </li>
          ))}
        </ol>
      </nav>
      <main
        className={`${styles.content} ${step === 1 ? styles.nodesContent : ''}`}
      >
        {preview && <p className={styles.preview}>开发预览 · 数据为演示场景</p>}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <WizardFooterContext.Provider value={footerHost}>
          {children}
        </WizardFooterContext.Provider>
      </main>
      <footer ref={setFooterHost} className={styles.footer}>
        {footer}
      </footer>
    </div>
  );
}

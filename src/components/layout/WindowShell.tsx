import { WindowActions } from './WindowActions';
import { WizardFooterContext } from './WizardActions';
import { useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
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
  contentClassName = '',
}: {
  children: ReactNode;
  footer: ReactNode;
  window: WindowControls;
  preview: boolean;
  step?: number | null;
  virtualRuntime?: boolean;
  contentClassName?: string;
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
      className={`${styles.shell} ${step === null ? styles.simpleShell : ''} ${step === 1 || step === 2 || step === 3 || step === 5 ? styles.nodesShell : ''} ${virtualRuntime ? styles.virtualShell : ''}`}
    >
      <header className={styles.titlebar} data-tauri-drag-region>
        <img src={logo} alt="CodeSeam" draggable={false} />
        <WindowActions
          onMinimize={() => act(window.minimize)}
          onMaximize={() => act(window.maximize)}
          onClose={() => act(window.close)}
        />
      </header>
      {visibleStep !== null && (
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
      )}
      <main
        className={`${styles.content} ${step === 1 ? styles.nodesContent : ''} ${contentClassName}`}
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

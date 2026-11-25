import { WindowActions } from './WindowActions';
import { useState, type ReactNode } from 'react';
import { Home, Layers, Share2, Orbit, Settings } from 'lucide-react';
import type { WindowControls } from '../../core/platform/window';
import logo from '../../assets/codeseam-logo.svg';
import styles from './WorkspaceShell.module.css';

export type WorkspaceDestination =
  '工作台' | '运行环境' | '节点与代理' | '专用浏览器' | '设置';
const destinations = [
  { name: '工作台', icon: Home },
  { name: '运行环境', icon: Layers },
  { name: '节点与代理', icon: Share2 },
  { name: '专用浏览器', icon: Orbit },
] as const;

export function WorkspaceShell({
  children,
  footer,
  window: controls,
  preview,
  active,
  onNavigate,
  navigationLocked = false,
}: {
  children: ReactNode;
  footer: ReactNode;
  window: WindowControls;
  preview: boolean;
  active: WorkspaceDestination;
  onNavigate: (destination: WorkspaceDestination) => void;
  navigationLocked?: boolean;
}) {
  const [error, setError] = useState('');
  const act = (action: () => Promise<void>) => {
    void action().catch((reason: Error) => setError(reason.message));
  };
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <img src={logo} alt="CodeSeam" draggable={false} />
        <nav aria-label="主导航">
          {destinations.map(({ name, icon: Icon }) => (
            <button
              key={name}
              type="button"
              title={name}
              aria-label={name}
              disabled={navigationLocked}
              aria-current={active === name ? 'page' : undefined}
              className={active === name ? styles.active : ''}
              onClick={() => onNavigate(name)}
            >
              <Icon />
            </button>
          ))}
        </nav>
        <button
          type="button"
          title="设置"
          aria-label="设置"
          disabled={navigationLocked}
          aria-current={active === '设置' ? 'page' : undefined}
          className={`${styles.settings} ${active === '设置' ? styles.active : ''}`}
          onClick={() => onNavigate('设置')}
        >
          <Settings />
        </button>
      </aside>
      <header className={styles.titlebar} data-tauri-drag-region>
        {preview && <small>开发预览 · 数据为演示场景</small>}
        <WindowActions
          onMinimize={() => act(controls.minimize)}
          onMaximize={() => act(controls.maximize)}
          onClose={() => act(controls.close)}
        />
      </header>
      <main className={styles.main}>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {children}
      </main>
      {footer}
    </div>
  );
}

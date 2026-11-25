import { ShieldCheck } from 'lucide-react';
import styles from './WorkspaceStatusBar.module.css';

export function WorkspaceStatusBar({
  status,
  lastChecked,
  version,
}: {
  status: string;
  lastChecked: string;
  version: string;
}) {
  return (
    <footer className={styles.footer}>
      <ShieldCheck />
      <strong>{status}</strong>
      <span>最后检测：{lastChecked}</span>
      <b>版本 v{version}</b>
    </footer>
  );
}

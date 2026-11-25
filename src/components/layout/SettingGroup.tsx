import { PanelTitle } from './PanelTitle';
import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import { WorkspacePanel } from './WorkspacePanel';
import styles from './SettingGroup.module.css';

export function SettingGroup({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <WorkspacePanel role="region" aria-labelledby={id} className={styles.group}>
      <PanelTitle id={id}>
        <Icon aria-hidden="true" />
        {title}
      </PanelTitle>
      {children}
    </WorkspacePanel>
  );
}

export function SettingRow({
  title,
  description,
  children,
  onClick,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className={styles.copy}>
        <span className={styles.label}>{title}</span>
        {description && (
          <span className={styles.description}>{description}</span>
        )}
      </span>
      {children && <span className={styles.trailing}>{children}</span>}
      {onClick && (
        <ChevronRight className={styles.chevron} size={21} aria-hidden="true" />
      )}
    </>
  );
  return onClick ? (
    <button
      type="button"
      className={`${styles.row} ${styles.link}`}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <div className={styles.row}>{content}</div>
  );
}

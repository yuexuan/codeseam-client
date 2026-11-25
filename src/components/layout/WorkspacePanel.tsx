import type { HTMLAttributes } from 'react';
import { Surface } from '../ui/Surface';
import styles from './WorkspacePanel.module.css';

export function WorkspacePanel({
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <Surface className={`${styles.panel} ${className}`} {...props} />;
}

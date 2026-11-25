import type { HTMLAttributes } from 'react';
import styles from './PanelTitle.module.css';

export function PanelTitle({
  className = '',
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 {...props} className={`${styles.title} ${className}`} />;
}

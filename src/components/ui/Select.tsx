import type { SelectHTMLAttributes } from 'react';
import styles from './Select.module.css';
export function Select({
  className = '',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${styles.select} ${className}`} />;
}

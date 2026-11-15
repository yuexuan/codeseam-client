import type { InputHTMLAttributes } from 'react';
import styles from './Radio.module.css';
export function Radio({
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <input {...props} type="radio" className={`${styles.radio} ${className}`} />
  );
}

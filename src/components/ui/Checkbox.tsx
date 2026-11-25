import type { InputHTMLAttributes } from 'react';
import styles from './ChoiceInput.module.css';
export function Checkbox({
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <input
      {...props}
      type="checkbox"
      className={`${styles.choice} ${className}`}
    />
  );
}

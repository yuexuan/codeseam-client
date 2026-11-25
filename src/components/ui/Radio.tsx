import type { InputHTMLAttributes } from 'react';
import styles from './ChoiceInput.module.css';
export function Radio({
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <input
      {...props}
      type="radio"
      className={`${styles.choice} ${className}`}
    />
  );
}

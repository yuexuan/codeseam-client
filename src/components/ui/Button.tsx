import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';
type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'quiet' | 'icon';
};
export function Button({ variant = 'quiet', className = '', ...props }: Props) {
  return (
    <button
      type="button"
      className={`${styles.button} ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';
type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'quiet' | 'icon' | 'back' | 'outline' | 'danger';
  size?: 'default' | 'icon';
};
export function Button({
  variant = 'quiet',
  size = 'default',
  className = '',
  ...props
}: Props) {
  return (
    <button
      type="button"
      className={`${styles.button} ${styles[variant]} ${size === 'icon' ? styles.icon : ''} ${className}`}
      {...props}
    />
  );
}

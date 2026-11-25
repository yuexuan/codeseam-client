import type { ButtonHTMLAttributes } from 'react';
import styles from './Switch.module.css';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  checked: boolean;
  onChange: (checked: boolean) => void;
};
export function Switch({ checked, onChange, className = '', ...props }: Props) {
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      className={`${styles.switch} ${className}`}
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden="true" />
    </button>
  );
}

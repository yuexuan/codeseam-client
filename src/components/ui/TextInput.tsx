import type { ComponentPropsWithRef } from 'react';
import styles from './TextInput.module.css';

export function TextInput({
  className = '',
  ...props
}: ComponentPropsWithRef<'input'>) {
  return <input {...props} className={`${styles.input} ${className}`} />;
}

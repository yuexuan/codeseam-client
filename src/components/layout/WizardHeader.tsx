import { useEffect, useRef, type ReactNode } from 'react';
import styles from './WizardHeader.module.css';

export function WizardHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children?: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <header className={styles.header}>
      <div>
        <h1 ref={heading} tabIndex={-1}>
          {title}
        </h1>
        <p>{description}</p>
      </div>
      {children && <div className={styles.actions}>{children}</div>}
    </header>
  );
}

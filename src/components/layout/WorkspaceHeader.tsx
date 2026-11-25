import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import styles from './WorkspaceHeader.module.css';

export function WorkspaceHeader({
  title,
  children,
  onBack,
  backLabel = '返回设置',
}: {
  title: string;
  children?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.closest('main')?.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <header className={styles.heading}>
      <div className={styles.title}>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={backLabel}
            title={backLabel}
          >
            <ArrowLeft />
          </button>
        )}
        <h1 ref={heading} tabIndex={-1}>
          {title}
        </h1>
      </div>
      {children}
    </header>
  );
}

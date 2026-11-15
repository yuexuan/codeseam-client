import type { ReactNode } from 'react';
import { Check, CircleAlert, LoaderCircle } from 'lucide-react';
import { Surface } from './Surface';
import { StatusLabel } from './StatusLabel';
import styles from './DetectionSummary.module.css';

export function DetectionSummary({
  state,
  title,
  description,
  counts,
  completeLabel = '已完成检测',
  stale = false,
  action,
}: {
  state: 'idle' | 'scanning' | 'error' | 'completed';
  title: string;
  description: string;
  counts?: { pending: number; unknown: number; optional: number };
  completeLabel?: string;
  stale?: boolean;
  action?: ReactNode;
}) {
  const Icon =
    state === 'error'
      ? CircleAlert
      : state === 'completed'
        ? Check
        : LoaderCircle;
  return (
    <Surface className={styles.summary} aria-live="polite">
      <div
        className={`${styles.summaryIcon} ${state === 'error' ? styles.failed : state !== 'completed' ? styles.working : ''}`}
      >
        <Icon size={45} aria-hidden="true" />
      </div>
      <div className={styles.summaryText}>
        <h2>{title}</h2>
        <p>{description}</p>
        <div className={styles.counts}>
          {counts && state === 'completed' && (
            <>
              <span className={styles.badge}>{counts.pending} 项待处理</span>
              <span className={styles.unknown}>
                {counts.unknown} 项无法确认
              </span>
              <span className={styles.unknown}>{counts.optional} 项可选</span>
              <StatusLabel status="satisfied" label={completeLabel} />
            </>
          )}
          {stale && (
            <span className={styles.unknown}>下方为上次结果，已过期</span>
          )}
        </div>
      </div>
      {action && <div className={styles.action}>{action}</div>}
    </Surface>
  );
}

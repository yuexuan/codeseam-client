import type { LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { StatusLabel } from './StatusLabel';
import styles from './CheckRow.module.css';

type Props = {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  status: ComponentProps<typeof StatusLabel>['status'];
  statusLabel?: string;
  title?: string;
  compact?: boolean;
  descriptionBelow?: boolean;
};

export function CheckRow({
  icon: Icon,
  label,
  value,
  status,
  statusLabel,
  title,
  compact,
  descriptionBelow = false,
}: Props) {
  return (
    <div
      className={`${compact ? styles.compact : styles.row} ${descriptionBelow ? styles.descriptionBelow : ''}`}
      title={title}
    >
      <Icon className={styles.icon} aria-hidden="true" />
      <strong>{label}</strong>
      <span className={styles.value}>{value}</span>
      <StatusLabel status={status} label={statusLabel} />
    </div>
  );
}

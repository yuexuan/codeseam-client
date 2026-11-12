import {
  CircleCheck,
  CircleAlert,
  CircleHelp,
  LoaderCircle,
} from 'lucide-react';
import type { Status } from '../../bindings/commands';
import styles from './StatusLabel.module.css';
const labels: Record<Status, string> = {
  satisfied: '已检测',
  pending: '待处理',
  unknown: '无法确认',
  optional: '可选',
  unsupported: '不支持',
};
export function StatusLabel({ status }: { status: Status | 'scanning' }) {
  const Icon =
    status === 'satisfied'
      ? CircleCheck
      : status === 'pending' || status === 'unsupported'
        ? CircleAlert
        : status === 'scanning'
          ? LoaderCircle
          : CircleHelp;
  return (
    <span className={`${styles.status} ${styles[status]}`}>
      <Icon size={18} aria-hidden="true" />
      <span>{status === 'scanning' ? '检测中' : labels[status]}</span>
    </span>
  );
}

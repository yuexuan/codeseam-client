import { Globe, MapPin, Monitor } from 'lucide-react';
import styles from './RuntimeIdentity.module.css';

/** 展示传入的信息；校验和基线选择仍由功能模块负责。 */
export function RuntimeIdentity({
  runtime,
  node,
  exitIp,
  onRuntime,
  onNode,
}: {
  runtime: string;
  node: string;
  exitIp: string;
  onRuntime?: () => void;
  onNode?: () => void;
}) {
  const items = [
    {
      label: '当前 Runtime',
      value: runtime,
      icon: Monitor,
      onClick: onRuntime,
    },
    { label: '出口节点', value: node, icon: MapPin, onClick: onNode },
    { label: '出口 IP', value: exitIp, icon: Globe, onClick: onNode },
  ];
  return (
    <div className={styles.identity}>
      {items.map(({ label, value, icon: Icon, onClick }) => {
        const content = (
          <>
            <Icon aria-hidden="true" />
            <span className={styles.label}>{label}</span>
            <strong>{value}</strong>
          </>
        );
        return onClick ? (
          <button
            type="button"
            key={label}
            className={styles.item}
            onClick={onClick}
            aria-label={`${label}：${value}`}
            title={`${label}：${value}`}
          >
            {content}
          </button>
        ) : (
          <span
            key={label}
            className={styles.item}
            title={`${label}：${value}`}
          >
            {content}
          </span>
        );
      })}
    </div>
  );
}

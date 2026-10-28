import type { ReactNode } from "react";

interface Props {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  /** 值右侧的灰色补充（如“总计 …”）。 */
  sub?: ReactNode;
  /** 0–100；缺省则不显示进度条。 */
  percent?: number;
  /** 进度条右侧的百分比文案，缺省按 percent 取整。 */
  percentText?: string;
}

/** 用量页统计卡：图标块 + 标签 + 主值 + 补充说明 + 可选进度条。 */
export function UsageStat({ icon, label, value, sub, percent, percentText }: Props) {
  return (
    <div className="stat-card usage-stat">
      <div className="top">
        <span className="tile-icon tile-icon--gold">{icon}</span>
        <div>
          <small className="label">{label}</small>
          <span className="value">{value}</span>
        </div>
      </div>
      {percent != null ? (
        <div className="usage-stat-bar">
          <div className="progress-track" role="progressbar" aria-label={label} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
          </div>
          <span>{percentText ?? `${Math.round(percent)}%`}</span>
        </div>
      ) : null}
      {sub && <small className="usage-stat-sub">{sub}</small>}
    </div>
  );
}

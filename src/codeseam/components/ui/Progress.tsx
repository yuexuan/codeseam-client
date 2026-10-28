interface Props {
  label: string;
  /** 已用值；percent 缺省时由 used/total 推导。 */
  percent?: number;
  used?: number;
  total?: number;
  hint?: string;
}

/** 渐变进度条：品牌金渐变填充，浅色轨道。 */
export function Progress({ label, percent, used, total, hint }: Props) {
  const p =
    percent ??
    (total && total > 0 && used != null
      ? Math.min(100, Math.max(0, (used / total) * 100))
      : 0);
  const valueText =
    used != null && total != null && total > 0
      ? `已使用 ${p.toFixed(0)}%（${used.toLocaleString("zh-CN")} / ${total.toLocaleString("zh-CN")}）`
      : `已使用 ${p.toFixed(0)}%`;
  return (
    <div className="progress-row">
      <div className="row">
        <span>{label}</span>
        <small>
          <strong>{valueText}</strong>
        </small>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(p)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, p))}%` }} />
      </div>
      {hint && <small className="hint">{hint}</small>}
    </div>
  );
}
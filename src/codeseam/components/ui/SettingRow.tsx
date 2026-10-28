import type { ReactNode } from "react";

/** 设置分组：标题 + 一组行，行之间以发丝线分隔。 */
export function SettingGroup({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="set-group">
      <h2>{title}</h2>
      {subtitle && <p className="set-group-sub">{subtitle}</p>}
      <div className="set-rows">{children}</div>
    </section>
  );
}

/** 设置行：左侧名称 + 说明，右侧控件（开关、选择、按钮或只读值）。 */
export function SettingRow({
  title,
  desc,
  children,
  stack,
}: {
  title: ReactNode;
  desc?: ReactNode;
  children?: ReactNode;
  /** 控件较宽（输入框等）时改为上下排布。 */
  stack?: boolean;
}) {
  return (
    <div className={`set-row${stack ? " set-row--stack" : ""}`}>
      <div className="set-text">
        <strong>{title}</strong>
        {desc && <span>{desc}</span>}
      </div>
      {children != null && <div className="set-control">{children}</div>}
    </div>
  );
}

import type { ReactNode } from "react";

interface Props {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  flat?: boolean;
  className?: string;
  children: ReactNode;
}

/** 通用卡片：标题 + 副标题 + 右上动作，正文由 children 提供。 */
export function Card({ title, subtitle, action, flat, className = "", children }: Props) {
  const cls = ["card", flat && "card--flat", className].filter(Boolean).join(" ");
  return (
    <section className={cls}>
      {(title || action) && (
        <div className="card-head">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {subtitle && <p className="card-sub">{subtitle}</p>}
      {children}
    </section>
  );
}
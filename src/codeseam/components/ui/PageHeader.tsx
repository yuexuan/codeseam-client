import type { ReactNode } from "react";

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
}

/** 内容区页头：页面标题 + 副标题 + 右侧动作。 */
export function PageHeader({ title, subtitle, badge, actions }: Props) {
  return (
    <div className="page-header">
      <div>
        <h1>
          {title}
          {badge}
        </h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}
import {
  ChevronRight,
  LayoutDashboard,
  Settings,
  SquareTerminal,
  Stethoscope,
  ChartColumn,
} from "lucide-react";
import type { ReactElement } from "react";
import type { CodeSeam } from "../lib/useCodeSeam";
import type { PageId } from "../lib/types";
import { date } from "../lib/format";
import { Badge } from "./ui/Badge";

const NAV: { id: PageId; label: string; icon: ReactElement }[] = [
  { id: "overview", label: "概览", icon: <LayoutDashboard size={17} /> },
  { id: "diagnostics", label: "环境诊断", icon: <Stethoscope size={17} /> },
  { id: "claude", label: "Claude Code", icon: <SquareTerminal size={17} /> },
  { id: "usage", label: "用量管理", icon: <ChartColumn size={17} /> },
  { id: "settings", label: "设置", icon: <Settings size={17} /> },
];

/** 左侧主菜单：导航 + 底部账号卡。 */
export function Sidebar({
  cs,
  page,
  onSelect,
  onAccount,
}: {
  onAccount: () => void;
  cs: CodeSeam;
  page: PageId;
  onSelect: (p: PageId) => void;
}) {
  const { status, service, email } = cs;
  return (
    <aside className="sidebar">
      <nav aria-label="主导航">
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`nav-btn${page === item.id ? " selected" : ""}`}
            aria-current={page === item.id ? "page" : undefined}
            onClick={() => onSelect(item.id)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>
      <button type="button" className="user-card user-card--action" onClick={onAccount} aria-haspopup={status?.logged_in ? undefined : "dialog"}>
        <span className="avatar" aria-hidden="true">
          {(email?.[0] || "C").toUpperCase()}
        </span>
        <div className="user-card-meta">
          <strong>
            <span className="name">{status?.logged_in ? email || "已登录" : "登录账号"}</span>
            {status?.logged_in && service && <Badge tone="pro">{service.name}</Badge>}
          </strong>
          <small>{status?.logged_in ? service ? `到期 ${date(service.expires_at)}` : "管理账号与连接" : "按需连接编程服务"}</small>
        </div>
        <ChevronRight className="user-card-arrow" size={16} aria-hidden="true" />
      </button>
    </aside>
  );
}

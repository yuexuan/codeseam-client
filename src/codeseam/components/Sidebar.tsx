import {
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
}: {
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
      <div className="user-card">
        <span className="avatar" aria-hidden="true">
          {(email?.[0] || "C").toUpperCase()}
        </span>
        <div className="user-card-meta">
          <strong>
            <span className="name">{email || (status?.logged_in ? "已登录" : "尚未登录")}</span>
            {service && <Badge tone="pro">{service.name}</Badge>}
          </strong>
          <small>{service ? `到期 ${date(service.expires_at)}` : "连接你的编程服务"}</small>
        </div>
      </div>
    </aside>
  );
}
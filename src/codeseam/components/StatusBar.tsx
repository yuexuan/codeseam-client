import { ShieldCheck } from "lucide-react";
import type { CodeSeam } from "../lib/useCodeSeam";
import { StatusDot } from "./ui/StatusDot";

/** 底部状态栏：连接状态 · 代理信息 · 安全状态。 */
export function StatusBar({ cs }: { cs: CodeSeam }) {
  const { status } = cs;
  return (
    <footer className="statusbar">
      <div className="status-item">
        <StatusDot tone={status?.proxy_running ? "green" : "gray"} />
        <div className="meta">
          <strong>{status?.proxy_running ? "本地连接已就绪" : "等待连接服务"}</strong>
          <small>
            {status?.proxy_running
              ? "可随时启动 Claude Code 使用"
              : "登录并激活服务后自动连接"}
          </small>
        </div>
      </div>
      <div className="status-item">
        <div className="meta">
          <strong>代理：{status?.local_url?.replace(/^https?:\/\//, "") || "未运行"}</strong>
          <small>模式：{status?.configured ? "受管" : "未托管"}</small>
        </div>
      </div>
      <div className="status-item">
        <ShieldCheck size={15} aria-hidden="true" />
        <div className="meta">
          <strong>系统安全</strong>
          <small>
            {status?.configured ? "环境受保护 · 安全策略已启用" : "受管模式待配置"}
          </small>
        </div>
      </div>
    </footer>
  );
}
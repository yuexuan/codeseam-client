import { LogOut, Plug, Unplug } from "lucide-react";
import type { CodeSeam } from "../../lib/useCodeSeam";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { SettingGroup, SettingRow } from "../../components/ui/SettingRow";

/** 代理设置：服务连接地址、本地代理运行状态与账号。 */
export function ProxySettings({ cs }: { cs: CodeSeam }) {
  const { status, server, setServer, portal, setPortal, busy, email } = cs;
  const loggedIn = !!status?.logged_in;
  const running = !!status?.proxy_running;
  const serviceId = status?.service_id;
  return (
    <>
      <SettingGroup title="服务连接" subtitle="CodeSeam 云端服务与用户门户的地址。">
        <SettingRow title="服务端地址" desc="登录与授权同步使用；更换服务端请先退出登录。" stack>
          <input
            type="url"
            aria-label="服务端地址"
            value={status?.server || server}
            disabled={loggedIn}
            onChange={(e) => setServer(e.target.value)}
          />
        </SettingRow>
        <SettingRow title="用户 Portal 地址" desc="用于查看服务、续费与下载客户端。" stack>
          <input
            type="url"
            aria-label="用户 Portal 地址"
            value={portal}
            onChange={(e) => setPortal(e.target.value)}
          />
        </SettingRow>
        <div className="set-actions">
          <Button variant="primary" onClick={cs.saveConnection}>
            保存设置
          </Button>
          <Button
            disabled={busy || !portal}
            onClick={() => void cs.run("cs_open_portal", { url: portal })}
          >
            用户服务门户
          </Button>
        </div>
        <p className="set-note">远端服务必须使用 HTTPS；HTTP 仅支持本机测试。</p>
      </SettingGroup>

      <SettingGroup
        title="本地代理"
        subtitle="Claude Code 只连接本机回环地址，真实服务授权保留在本地受管服务中。"
      >
        <SettingRow title="运行状态" desc="代理失效时受保护请求会被拒绝，不会回退直连。">
          <Badge tone={running ? "green" : "amber"}>{running ? "运行中" : "未运行"}</Badge>
        </SettingRow>
        <SettingRow title="监听地址" desc="仅绑定 127.0.0.1，端口由客户端固定分配。">
          <span className="set-value mono">{status?.local_url || "—"}</span>
        </SettingRow>
        <SettingRow title="已转发请求" desc="本次运行以来经本地代理转发的请求数。">
          <span className="set-value">{status?.requests ?? 0}</span>
        </SettingRow>
        <SettingRow title="专属出口" desc="服务端为当前服务分配的预期出口，实际出口以环境诊断为准。">
          <span className="set-value mono">{status?.network?.expected_egress || "未下发"}</span>
        </SettingRow>
        <div className="set-actions">
          <Button
            icon={<Plug size={14} />}
            disabled={busy || serviceId == null || running}
            onClick={() => serviceId != null && void cs.run("cs_activate", { id: serviceId })}
          >
            连接代理
          </Button>
          <Button
            icon={<Unplug size={14} />}
            disabled={busy || !running || !!status?.cli_pid}
            onClick={() => void cs.run("cs_disconnect")}
          >
            断开代理
          </Button>
        </div>
        {!!status?.cli_pid && (
          <p className="set-note">受管 Claude 终端运行中，请先在 Claude Code 页关闭终端再断开代理。</p>
        )}
      </SettingGroup>

      <SettingGroup
        title="账号"
        subtitle="退出登录会关闭受管终端、断开代理并恢复原 Claude API 配置；字段冲突时保留加密备份并提示处理。"
      >
        <SettingRow title="当前账号" desc="登录凭据与服务 Key 是两回事，客户端不会要求你复制 Key。">
          <span className="set-value">{loggedIn ? email || "已登录" : "尚未登录"}</span>
        </SettingRow>
        <div className="set-actions">
          <Button
            variant="primary"
            icon={<LogOut size={14} />}
            disabled={busy || !loggedIn}
            onClick={() => void cs.run("cs_logout")}
          >
            退出登录并恢复配置
          </Button>
        </div>
      </SettingGroup>
    </>
  );
}

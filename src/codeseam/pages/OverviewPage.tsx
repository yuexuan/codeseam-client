import {
  BookOpen,
  CalendarClock,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  FilePenLine,
  FileText,
  FolderOpen,
  Gauge,
  Globe,
  Play,
  RefreshCw,
  ScrollText,
  Server,
  ShieldCheck,
  SquareTerminal,
  Stethoscope,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { CodeSeam } from "../lib/useCodeSeam";
import type { PageId } from "../lib/types";
import { activityTime, checkText, date, daysLeft, num, stateText } from "../lib/format";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { PageHeader } from "../components/ui/PageHeader";
import { Progress } from "../components/ui/Progress";
import { StatusDot } from "../components/ui/StatusDot";
import { Badge } from "../components/ui/Badge";
import type { ActivityEvent } from "../lib/types";

/** 首页（概览）：状态速览 + 连接总览 + 快捷操作 + 用量/活动/帮助。 */
export function OverviewPage({
  cs,
  setPage,
}: {
  cs: CodeSeam;
  setPage: (p: PageId) => void;
}) {
  const { status, service, report, usage, busy } = cs;
  const connected = !!status?.proxy_running;

  useEffect(() => {
    cs.askUsage();
  }, [cs, status?.logged_in, busy]);

  const launch = (
    <Button
      variant="primary"
      icon={<Play size={14} />}
      disabled={
        busy || !status?.cli || !status.configured || !status.proxy_running || !!status.cli_pid
      }
      onClick={() => void cs.run("cs_launch")}
    >
      启动 Claude Code
    </Button>
  );

  return (
    <>
      <PageHeader
        title="概览"
        subtitle="通过本地代理连接你的 Claude Code，提供稳定、安全的使用环境。"
        actions={
          <>
            <Button
              icon={<RefreshCw size={13} />}
              disabled={busy || !status?.logged_in}
              onClick={() => void cs.run("cs_refresh")}
            >
              刷新状态
            </Button>
            {launch}
          </>
        }
      />

      {!status?.logged_in && <LoginCard cs={cs} />}

      <div className="overview-grid">
        {/* 状态速览 */}
        <div className="stat-grid">
          <StatCard
            icon={<Gauge size={20} />}
            tone="gold"
            label="服务状态"
            value={
              service
                ? (stateText[service.state] ?? service.state)
                : status?.logged_in
                  ? "尚未开通"
                  : "未登录"
            }
            valueOk={service?.state === "ACTIVE"}
            sub={
              status?.logged_in
                ? service
                  ? "服务运行稳定，状态实时同步"
                  : "可在用户服务门户开通"
                : "登录后连接你的编程服务"
            }
          />
          <StatCard
            icon={<Server size={20} />}
            tone="green"
            label="本地代理"
            value={connected ? "运行中" : "未连接"}
            valueOk={connected}
            sub={
              connected
                ? status?.local_url?.replace(/^https?:\/\//, "") || "127.0.0.1"
                : "激活服务后自动启动本地代理"
            }
          />
          <StatCard
            icon={<CalendarClock size={20} />}
            tone="gold"
            label="有效期"
            value={
              daysLeft(service?.expires_at) != null
                ? `剩余 ${daysLeft(service?.expires_at)} 天`
                : "未提供"
            }
            sub={`到期日 ${date(service?.expires_at)}`}
          />
          <StatCard
            icon={<ShieldCheck size={20} />}
            tone="green"
            label="安全状态"
            value={
              report
                ? report.apiProtection === "pass"
                  ? "环境受保护"
                  : report.apiProtection === "fail"
                    ? "存在风险"
                    : (checkText[report.apiProtection] ?? "待验证")
                : "待验证"
            }
            valueOk={report?.apiProtection === "pass"}
            sub={
              status?.configured
                ? "受管模式运行，安全策略已启用"
                : "受管字段未配置，先完成配置"
            }
          />
        </div>

        {/* 连接总览 + 快捷操作 */}
        <div className="row-2">
          <Card
            title="连接总览"
            subtitle="系统各组件运行状态，确保 Claude Code 可以正常使用。"
          >
            <ConnRow
              icon={<Server size={17} />}
              label="本地代理"
              state={connected ? "运行中" : "未连接"}
              ok={connected}
              desc={
                connected
                  ? status?.local_url?.replace(/^https?:\/\//, "") || "本地代理端口已就绪"
                  : "激活服务后自动启动"
              }
              onOpen={() => setPage("claude")}
            />
            <ConnRow
              icon={<SquareTerminal size={17} />}
              label="Claude Code"
              state={status?.cli ? "已安装" : "未检测到"}
              ok={!!status?.cli}
              desc={
                status?.cli
                  ? status.cli_pid
                    ? `终端运行中 · PID ${status.cli_pid}`
                    : "配置一次即可随时开始"
                  : "请安装官方 Claude Code 后重试"
              }
              onOpen={() => setPage("claude")}
            />
            <ConnRow
              icon={<Globe size={17} />}
              label="网络出口"
              state={report ? (checkText[report.apiProtection] ?? report.apiProtection) : "待验证"}
              ok={report?.apiProtection === "pass"}
              desc={
                status?.network?.expected_egress
                  ? `预期出口 ${status.network.expected_egress}`
                  : "运行环境诊断后验证出口"
              }
              onOpen={() => setPage("diagnostics")}
            />
            <ConnRow
              icon={<ShieldCheck size={17} />}
              label="环境保护"
              state={status?.configured ? "已启用" : "未启用"}
              ok={!!status?.configured}
              desc="受管模式，仅改写 API 字段"
              onOpen={() => setPage("diagnostics")}
            />
          </Card>
          <Card
            title="快捷操作"
            subtitle="常用功能，帮助你快速开始或解决问题。"
          >
            <div className="quick-grid">
              <button className="quick-tile" onClick={() => setPage("diagnostics")}>
                <span className="tile-icon tile-icon--gold">
                  <Stethoscope size={18} />
                </span>
                <strong>环境诊断</strong>
                <small>检测本地环境状态</small>
              </button>
              <button className="quick-tile" onClick={() => setPage("claude")}>
                <span className="tile-icon tile-icon--gold">
                  <FilePenLine size={18} />
                </span>
                <strong>编辑配置</strong>
                <small>修改代理与服务配置</small>
              </button>
              <button
                className="quick-tile"
                onClick={() => void cs.run("cs_open_path", { kind: "claude" })}
              >
                <span className="tile-icon tile-icon--green">
                  <FolderOpen size={18} />
                </span>
                <strong>打开配置目录</strong>
                <small>快速定位配置文件</small>
              </button>
              <button
                className="quick-tile"
                onClick={() => {
                  cs.setSettingsTab("logs");
                  setPage("settings");
                }}
              >
                <span className="tile-icon tile-icon--green">
                  <ScrollText size={18} />
                </span>
                <strong>查看日志</strong>
                <small>查看活动记录与诊断报告</small>
              </button>
            </div>
          </Card>
        </div>

        {/* 用量速览 + 近期活动 + 帮助与文档 */}
        <div className="row-3">
          <Card
            title="用量速览"
            subtitle="Claude Code 使用额度与计量统计，定期重置。"
            action={
              <button className="link" onClick={() => setPage("usage")}>
                查看全部
                <ChevronRight size={13} />
              </button>
            }
          >
            <Progress
              label="平台额度"
              used={service?.quota_used}
              total={service?.quota}
              hint={`已用 ${num(service?.quota_used)} / 共 ${num(service?.quota)} · 到期 ${date(service?.expires_at)}`}
            />
            <div className="mini-stats">
              <div className="mini-stat">
                <small>总请求数</small>
                <span className="num">{num(usage?.total_requests)}</span>
                <Badge tone="gold">本月</Badge>
              </div>
              <div className="mini-stat">
                <small>总 Token 数</small>
                <span className="num">{num(usage?.total_tokens)}</span>
                <Badge tone="gold">本月</Badge>
              </div>
            </div>
          </Card>
          <Card title="近期活动" subtitle="连接、诊断与配置等本地事件。">
            <Timeline activity={cs.activity} />
          </Card>
          <Card title="帮助与文档" subtitle="">
            <button className="help-row" onClick={() => setPage("settings")}>
              <BookOpen size={16} />
              <span className="main">
                <strong>使用说明</strong>
                <small>了解 CodeSeam 的基本使用方法</small>
              </span>
              <ChevronRight className="chev" size={14} />
            </button>
            <button className="help-row" onClick={() => setPage("diagnostics")}>
              <CircleHelp size={16} />
              <span className="main">
                <strong>常见问题</strong>
                <small>查看常见问题与解决方案</small>
              </span>
              <ChevronRight className="chev" size={14} />
            </button>
            <button className="help-row" onClick={() => setPage("claude")}>
              <FileText size={16} />
              <span className="main">
                <strong>配置示例</strong>
                <small>查看配置信息与受管字段</small>
              </span>
              <ChevronRight className="chev" size={14} />
            </button>
          </Card>
        </div>
      </div>
    </>
  );
}

/** 状态卡：图标块 + 标签 + 主值 + 说明。 */
function StatCard({
  icon,
  tone,
  label,
  value,
  valueOk,
  sub,
}: {
  icon: ReactNode;
  tone: "gold" | "green";
  label: string;
  value: string;
  valueOk?: boolean;
  sub: string;
}) {
  return (
    <div className="stat-card">
      <div className="top">
        <span className={`tile-icon tile-icon--${tone}`}>{icon}</span>
        <div>
          <span className="label">{label}</span>
          <span className={`value${valueOk ? " value--green" : ""}`}>{value}</span>
        </div>
      </div>
      <small>{sub}</small>
    </div>
  );
}

/** 连接总览中的一行：图标 + 标签/状态 + 说明 + 详情链接。 */
function ConnRow({
  icon,
  label,
  state,
  ok,
  desc,
  onOpen,
}: {
  icon: ReactNode;
  label: string;
  state: string;
  ok?: boolean;
  desc: string;
  onOpen: () => void;
}) {
  return (
    <div className="conn-row">
      <span className="tile-icon">{icon}</span>
      <div className="main">
        <strong>
          {label} · <span className={`state${ok ? " state--ok" : " state--bad"}`}>{state}</span>
        </strong>
        <small>{desc}</small>
      </div>
      <button className="link" onClick={onOpen}>
        查看详情
        <ChevronRight size={13} />
      </button>
    </div>
  );
}

/** 近期活动时间线（最近 5 条）。 */
function Timeline({ activity }: { activity: ActivityEvent[] }) {
  const tone: Record<ActivityEvent["kind"], "green" | "gold" | "amber" | "gray"> = {
    connect: "green",
    check: "gold",
    config: "gold",
    info: "gray",
    warn: "amber",
  };
  if (!activity.length)
    return <small>暂无记录。启动、连接、诊断与配置操作会显示在这里。</small>;
  return (
    <div className="timeline">
      {activity.slice(0, 5).map((ev) => (
        <div className="timeline-item" key={ev.ts + ev.title}>
          <StatusDot tone={tone[ev.kind]} />
          <span className="time">{activityTime(ev.ts)}</span>
          <div className="body">
            <strong>{ev.title}</strong>
            {ev.detail && <small>{ev.detail}</small>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 未登录时的登录卡片。 */
function LoginCard({ cs }: { cs: CodeSeam }) {
  const { server, setServer, email, setEmail, busy } = cs;
  const [password, setPassword] = useState("");
  return (
    <Card title="登录 CodeSeam" className="login-form">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const p = password;
          setPassword("");
          void cs.run("cs_login", { server, email, password: p });
        }}
      >
        <label>
          服务端地址
          <input
            type="url"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            required
          />
        </label>
        <div className="fields">
          <label>
            邮箱
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            密码
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
        </div>
        <div className="actions">
          <Button variant="primary" disabled={busy}>
            登录
          </Button>
          <Button
            icon={<ExternalLink size={13} />}
            disabled={busy || !cs.portal}
            onClick={() => void cs.run("cs_open_portal", { url: cs.portal })}
          >
            用户服务门户
          </Button>
          <small>注册与找回密码请前往门户</small>
        </div>
      </form>
    </Card>
  );
}
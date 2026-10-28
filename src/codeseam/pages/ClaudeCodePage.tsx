import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  FilePenLine,
  FileText,
  FolderOpen,
  Play,
  Plug,
  Power,
  RotateCw,
  Trash2,
  Unplug,
  Wifi,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { CodeSeam } from "../lib/useCodeSeam";
import type { PageId } from "../lib/types";
import { checkText, fullTime } from "../lib/format";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { PageHeader } from "../components/ui/PageHeader";
import { StatusDot } from "../components/ui/StatusDot";
import { ManagedConfig } from "../components/ManagedConfig";

const hms = (ts: number) => fullTime(ts).slice(11);

/** Claude Code 页：配置信息 + 连接状态 + 运行终端 + 常用操作 + 帮助。 */
export function ClaudeCodePage({
  cs,
  setPage,
}: {
  cs: CodeSeam;
  setPage: (p: PageId) => void;
}) {
  const { status, report, cliInfo, busy } = cs;
  const [editing, setEditing] = useState(false);
  const [clearedAt, setClearedAt] = useState(0);

  useEffect(() => {
    void cs.loadCliInfo();
    // CLI 出现/配置变化后重新读取版本与配置概况。
  }, [status?.cli, status?.configured]);

  const connected = !!status?.proxy_running && !!status.configured && !!status.cli;
  const canLaunch = !busy && connected && !status?.cli_pid;
  const showEdit = editing || (!!status?.logged_in && !status.configured);
  const host = status?.local_url?.replace(/^https?:\/\//, "") || "";

  const launch = (
    <Button
      variant="primary"
      icon={<Play size={14} />}
      disabled={!canLaunch}
      onClick={() => void cs.run("cs_launch")}
    >
      启动 Claude Code
    </Button>
  );

  const restartProxy = async () => {
    if (status?.service_id == null) return;
    await cs.run("cs_disconnect");
    await cs.run("cs_activate", { id: status.service_id });
  };

  // 运行终端：受管 Claude 终端在独立窗口中运行，这里展示本机可观察的真实事件。
  const lines = useMemo(
    () =>
      cs.activity
        .filter((ev) => ev.ts > clearedAt)
        .slice(0, 12)
        .reverse(),
    [cs.activity, clearedAt],
  );

  const networkOk = report?.apiProtection === "pass";
  const networkText = report ? (checkText[report.apiProtection] ?? "待验证") : "待验证";

  return (
    <>
      <PageHeader
        title="Claude Code"
        subtitle="配置并通过本地代理连接 Claude Code，提供稳定、安全的使用体验。"
        badge={
          <Badge tone={status?.cli ? "green" : "amber"}>
            {status?.cli ? "已安装 · 可使用" : "未检测到"}
          </Badge>
        }
        actions={
          <>
            <Button icon={<FilePenLine size={14} />} onClick={() => setEditing(!showEdit)}>
              配置向导
            </Button>
            {launch}
          </>
        }
      />

      <div className="cc-grid">
        <div className="cc-col">
          <Card
            title="配置信息"
            action={
              <button className="link" onClick={() => setEditing(!showEdit)}>
                <FilePenLine size={13} />
                编辑配置
              </button>
            }
          >
            <dl className="cc-kv">
              <dt>代理地址</dt>
              <dd className="mono">{status?.local_url || "—"}</dd>
              <dt>认证方式</dt>
              <dd>
                {status?.configured ? "本地占位授权 · Bearer Token" : "未配置或受管字段已变化"}
              </dd>
              <dt>Claude 版本</dt>
              <dd>
                {cliInfo?.version || (status?.cli ? "未能读取版本" : "未检测到")}
                {status?.cli && <Badge tone="green">已安装</Badge>}
              </dd>
              <dt>安装位置</dt>
              <dd className="mono">{status?.cli || "请安装官方 Claude Code 后重试"}</dd>
              <dt>配置文件</dt>
              <dd className="mono">
                {cliInfo?.settings_path
                  ? cliInfo.settings_exists
                    ? cliInfo.settings_path
                    : `${cliInfo.settings_path}（尚未创建）`
                  : "—"}
              </dd>
              <dt>当前模型</dt>
              <dd>{cliInfo?.model || "默认（由 Claude Code 决定）"}</dd>
              <dt>超时设置</dt>
              <dd>
                {cliInfo?.timeout_ms ? `${Math.round(cliInfo.timeout_ms / 1000)} 秒` : "默认"}
              </dd>
              <dt>环境变量</dt>
              <dd>
                {cliInfo?.env_count ? `已配置 (${cliInfo.env_count} 项)` : "未配置"}
              </dd>
            </dl>
            {showEdit && (
              <div className="cc-edit">
                <ManagedConfig cs={cs} />
              </div>
            )}
          </Card>

          <Card
            title="运行终端"
            action={
              <div className="cc-card-actions">
                <Button
                  size="sm"
                  icon={<Power size={12} />}
                  disabled={busy || !status?.cli_pid}
                  onClick={() => void cs.run("cs_stop")}
                >
                  关闭终端
                </Button>
                <Button
                  size="sm"
                  icon={<Trash2 size={12} />}
                  disabled={!lines.length}
                  onClick={() => setClearedAt(Date.now())}
                >
                  清空
                </Button>
              </div>
            }
          >
            <div className="cc-term" role="log" aria-label="运行终端">
              <div>
                <span className="p">PS&gt;</span> claude --version
              </div>
              <div className="o">{cliInfo?.version || (status?.cli ? "—" : "未检测到 claude")}</div>
              {lines.map((ev) => (
                <div key={ev.ts + ev.title} className={ev.kind === "warn" ? "w" : "o"}>
                  [{hms(ev.ts)}] {ev.title}
                  {ev.detail ? ` · ${ev.detail}` : ""}
                </div>
              ))}
              <div>
                <span className="p">PS&gt;</span>{" "}
                {status?.cli_pid ? (
                  <span className="o">claude · 终端运行中 (PID {status.cli_pid})</span>
                ) : (
                  <span className="o">终端未运行</span>
                )}
                <span className="cc-caret" aria-hidden="true" />
              </div>
            </div>
            <small className="cc-note">
              受管 Claude 在独立 PowerShell 窗口中运行；此处显示版本与 CodeSeam 会话事件，
              已转发请求 {status?.requests ?? 0}。
            </small>
          </Card>
        </div>

        <div className="cc-col">
          <Card
            title="连接状态"
            action={
              <span className="cc-state">
                <StatusDot tone={connected ? "green" : "amber"} />
                <strong className={connected ? "ok" : "warn"}>
                  {connected ? "连接正常" : "未就绪"}
                </strong>
                <small>
                  最后检测：{report?.generatedAt ? fullTime(report.generatedAt * 1000) : "尚未检测"}
                </small>
              </span>
            }
          >
            <div className={`cc-hero${connected ? " cc-hero--ok" : ""}`}>
              <span className="cc-hero-icon">
                {connected ? <CheckCircle2 size={22} /> : <XCircle size={22} />}
              </span>
              <div>
                <strong>{connected ? "Claude Code 已成功连接" : "Claude Code 尚未连接"}</strong>
                <small>
                  {connected
                    ? "当前可以正常使用 Claude Code 进行开发。"
                    : !status?.cli
                      ? "未检测到官方 Claude Code，请安装后重试。"
                      : !status.proxy_running
                        ? "本地代理未运行，请先登录并激活服务。"
                        : "受管配置未生效，请在“配置信息”中完成备份并配置。"}
                </small>
              </div>
            </div>
            <StatusRow
              label="本地代理"
              ok={!!status?.proxy_running}
              state={status?.proxy_running ? "运行中" : "未连接"}
              right={host}
            />
            <StatusRow
              label="认证状态"
              ok={!!status?.configured}
              state={status?.configured ? "已配置" : "未配置"}
              right="Bearer Token"
            />
            <StatusRow
              label="网络连接"
              ok={networkOk}
              state={networkText}
              right={status?.network?.expected_egress ? `出口 ${status.network.expected_egress}` : ""}
            />
            <StatusRow
              label="Claude 访问"
              ok={!!report?.canStart}
              state={report ? (report.canStart ? "可启动" : "已阻断") : "待验证"}
              right={
                <button
                  className="link"
                  disabled={busy}
                  onClick={() => void cs.run("cs_diagnose")}
                >
                  测试连接
                  <ChevronRight size={13} />
                </button>
              }
            />
          </Card>

          <Card title="常用操作">
            <div className="cc-actions">
              <ActionTile
                icon={<Play size={17} />}
                title="启动 Claude Code"
                sub="通过本地代理启动"
                disabled={!canLaunch}
                onClick={() => void cs.run("cs_launch")}
              />
              <ActionTile
                icon={<RotateCw size={17} />}
                title="重启服务"
                sub="重启本地代理服务"
                disabled={busy || status?.service_id == null || !!status?.cli_pid}
                onClick={() => void restartProxy()}
              />
              <ActionTile
                icon={<FilePenLine size={17} />}
                title="编辑配置"
                sub="备份并配置 / 恢复原配置"
                onClick={() => setEditing(!showEdit)}
              />
              <ActionTile
                icon={<FolderOpen size={17} />}
                title="打开目录"
                sub="打开 Claude 配置目录"
                disabled={busy}
                onClick={() => void cs.run("cs_open_path", { kind: "claude" })}
              />
              <ActionTile
                icon={<Wifi size={17} />}
                title="测试连接"
                sub="检测 Claude 服务连通性"
                disabled={busy}
                onClick={() => void cs.run("cs_diagnose")}
              />
              <ActionTile
                icon={<Unplug size={17} />}
                title="断开连接"
                sub="停止本地代理并启用保护"
                disabled={busy || !status?.proxy_running}
                onClick={() => void cs.run("cs_disconnect")}
              />
            </div>
          </Card>

          <Card title="帮助与文档">
            <HelpRow
              icon={<BookOpen size={16} />}
              title="Claude Code 使用说明"
              onClick={() => setPage("settings")}
            />
            <HelpRow
              icon={<CircleHelp size={16} />}
              title="常见问题"
              onClick={() => setPage("diagnostics")}
            />
            <HelpRow
              icon={<FileText size={16} />}
              title="配置示例"
              onClick={() => setEditing(true)}
            />
          </Card>
        </div>
      </div>
    </>
  );
}

function StatusRow({
  label,
  state,
  ok,
  right,
}: {
  label: string;
  state: string;
  ok: boolean;
  right?: ReactNode;
}) {
  return (
    <div className="cc-status-row">
      <span className="label">
        <Plug size={14} />
        {label}
      </span>
      <span className="state">
        <StatusDot tone={ok ? "green" : "amber"} />
        <span className={ok ? "ok" : "warn"}>{state}</span>
      </span>
      <span className="right">{right}</span>
    </div>
  );
}

function ActionTile({
  icon,
  title,
  sub,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button className="cc-tile" disabled={disabled} onClick={onClick}>
      <span className="tile-icon tile-icon--gold">{icon}</span>
      <span className="main">
        <strong>{title}</strong>
        <small>{sub}</small>
      </span>
    </button>
  );
}

function HelpRow({
  icon,
  title,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button className="help-row" onClick={onClick}>
      {icon}
      <span className="main">
        <strong>{title}</strong>
      </span>
      <ChevronRight className="chev" size={14} />
    </button>
  );
}

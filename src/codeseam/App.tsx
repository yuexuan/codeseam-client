import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import logo from "./assets/codeseam-logo.svg";
import "./style.css";
type Service = {
  id: number;
  name: string;
  state: string;
  expires_at?: string;
  quota?: number;
  quota_used?: number;
};
type Status = {
  logged_in: boolean;
  server?: string;
  services: Service[];
  service_id?: number;
  proxy_running: boolean;
  configured: boolean;
  cli?: string;
  cli_pid?: number;
  local_url: string;
  network?: { revision: string; expected_egress: string };
  requests?: number;
};
type Report = {
  apiProtection: string;
  canStart: boolean;
  checks: {
    id: string;
    label: string;
    status: string;
    detail: string;
    evidence?: string;
    remediation?: string;
  }[];
};
const pages = ["服务概览", "Claude Code", "环境诊断", "用量管理", "设置"],
  icons = ["⌂", "⌘", "◇", "▥", "⚙"];
const states: Record<string, string> = {
  ACTIVE: "服务正常",
  EXPIRED: "已到期",
  DISABLED: "已停用",
  NOT_PROVISIONED: "待运营开通",
  SUSPENDED: "已暂停",
  QUOTA_EXHAUSTED: "额度不足",
  NOT_STARTED: "尚未开始",
};
const checks: Record<string, string> = {
  pass: "通过",
  fail: "失败",
  unknown: "待验证",
  warning: "待处理",
  not_applicable: "不适用",
};
const num = (v?: number) =>
  v == null
    ? "未提供"
    : v.toLocaleString("zh-CN", { maximumFractionDigits: 6 });
const date = (v?: string) =>
  v ? new Date(v).toLocaleString("zh-CN") : "未提供";
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export default function App() {
  const [s, setS] = useState<Status>(),
    [page, setPage] = useState(0),
    [server, setServer] = useState(
      localStorage.getItem("cs.server") || "http://127.0.0.1:18081",
    ),
    [portal, setPortal] = useState(
      localStorage.getItem("cs.portal") || "http://127.0.0.1:18081/portal/",
    ),
    [theme, setTheme] = useState(localStorage.getItem("cs.theme") || "light"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [report, setReport] = useState<Report>(),
    [usage, setUsage] = useState<Record<string, number>>(),
    [start, setStart] = useState(today().slice(0, 8) + "01"),
    [end, setEnd] = useState(today());
  const refresh = async () => setS(await invoke<Status>("cs_status"));
  async function run(cmd: string, args?: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await invoke(cmd, args);
      if (cmd === "cs_diagnose") setReport(r as Report);
      if (cmd === "cs_usage") setUsage(r as Record<string, number>);
      if (
        ["cs_logout", "cs_disconnect", "cs_activate", "cs_refresh"].includes(
          cmd,
        )
      )
        setReport(undefined);
      if (cmd === "cs_logout") {
        setUsage(undefined);
        setConsent(false);
      }
      if (cmd === "cs_login") {
        localStorage.setItem("cs.server", server);
        setPage(0);
      }
      await refresh();
      setNotice("操作已完成");
    } catch (e) {
      setError(String(e));
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    run("cs_resume");
    const t = setInterval(() => refresh().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("cs.theme", theme);
  }, [theme]);
  const service =
    s?.services.find((v) => v.id === s.service_id) || s?.services[0];
  const launch = (
    <button
      className="primary launch"
      disabled={
        busy || !s?.cli || !s.configured || !s.proxy_running || !!s.cli_pid
      }
      onClick={() => run("cs_launch")}
    >
      ▷ 启动 Claude Code
    </button>
  );
  const portalButton = (
    <button
      disabled={busy || !portal}
      onClick={() => run("cs_open_portal", { url: portal })}
    >
      用户服务门户 ↗
    </button>
  );
  const config = (
    <>
      <label className="consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        备份原配置，仅将 API 地址与授权改为本地受管字段。
      </label>
      <div className="actions">
        <button
          disabled={busy || !consent || !s?.proxy_running}
          onClick={() => run("cs_configure", { confirmed: consent })}
        >
          备份并配置
        </button>
        <button
          disabled={busy || !!s?.cli_pid}
          onClick={() => run("cs_restore")}
        >
          恢复原配置
        </button>
      </div>
    </>
  );
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <img src={logo} alt="CodeSeam" />
          <strong>CodeSeam</strong>
        </div>
        <nav aria-label="主导航">
          {pages.map((p, i) => (
            <button
              key={p}
              aria-current={page === i ? "page" : undefined}
              className={page === i ? "selected" : ""}
              onClick={() => setPage(i)}
            >
              <span>{icons[i]}</span>
              {p}
            </button>
          ))}
        </nav>
        <div className="account">
          <span className="avatar">◎</span>
          <div>
            <strong>{s?.logged_in ? "已登录" : "尚未登录"}</strong>
            <small>
              {service
                ? states[service.state] || service.state
                : "连接你的编程服务"}
            </small>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header>
          <span>
            CodeSeam <small>/ {pages[page]}</small>
          </span>
          <div className="actions">
            <button
              className="icon"
              aria-label="切换明暗主题"
              title="切换明暗主题"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? "☾" : "☀"}
            </button>
            <small>v0.5.0 · Windows</small>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <h1>{pages[page]}</h1>
              <p>
                {
                  [
                    "你的专属服务与本地连接状态",
                    "配置一次，随时开始编程",
                    "启动前检查与真实保护范围",
                    "来自服务端的真实平台计量",
                    "账号、连接与本地配置",
                  ][page]
                }
              </p>
            </div>
            {s?.logged_in && (
              <button disabled={busy} onClick={() => run("cs_refresh")}>
                ↻ 刷新服务
              </button>
            )}
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          {!s?.logged_in && (
            <section>
              <h2>登录 CodeSeam</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const p = password;
                  setPassword("");
                  run("cs_login", { server, email, password: p });
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
                  <button className="primary" disabled={busy}>
                    登录
                  </button>
                  {portalButton}
                  <small>注册与找回密码请前往门户</small>
                </div>
              </form>
            </section>
          )}
          {page === 0 && (
            <>
              <section>
                <div className="section-head">
                  <h2>服务概况</h2>
                  <span className="badge">
                    {service
                      ? states[service.state] || service.state
                      : "尚未开通"}
                  </span>
                </div>
                {s?.services.map((v) => (
                  <div className="service" key={v.id}>
                    <div>
                      <strong>{v.name}</strong>
                      <small>
                        {states[v.state] || v.state} · 到期 {date(v.expires_at)}
                      </small>
                    </div>
                    <button
                      disabled={busy || v.state !== "ACTIVE"}
                      onClick={() => run("cs_activate", { id: v.id })}
                    >
                      {s.service_id === v.id && s.proxy_running
                        ? "重新连接"
                        : "激活服务"}
                    </button>
                  </div>
                ))}
                <dl>
                  <dt>服务到期</dt>
                  <dd>{date(service?.expires_at)}</dd>
                  <dt>平台额度 / 已用</dt>
                  <dd>
                    {num(service?.quota)} / {num(service?.quota_used)}
                  </dd>
                </dl>
                {portalButton}
              </section>
              <section>
                <h2>连接状态</h2>
                {[
                  ["本地代理", s?.proxy_running ? "运行中" : "未连接", 1],
                  ["Claude Code", s?.cli ? "已安装" : "未检测到", 1],
                  [
                    "出口与网络保护",
                    report
                      ? checks[report.apiProtection] || report.apiProtection
                      : "待验证",
                    2,
                  ],
                ].map(([k, v, i]) => (
                  <div className="status-row" key={String(k)}>
                    <span>{k}</span>
                    <strong>{v}</strong>
                    <button onClick={() => setPage(Number(i))}>
                      查看详情 ›
                    </button>
                  </div>
                ))}
              </section>
            </>
          )}
          {page === 1 && (
            <>
              <section>
                <h2>Claude Code · 受管连接</h2>
                <dl>
                  <dt>CLI 安装位置</dt>
                  <dd>{s?.cli || "未检测到，请安装官方 Claude Code 后重试"}</dd>
                  <dt>配置状态</dt>
                  <dd>
                    {s?.configured
                      ? "本地占位授权已配置"
                      : "未配置或受管字段已变化"}
                  </dd>
                  <dt>连接地址</dt>
                  <dd>{s?.local_url || "http://127.0.0.1:18899/claude"}</dd>
                </dl>
                {config}
              </section>
              <section>
                <h2>运行控制</h2>
                <p>
                  启动时会重新验证授权并运行网络诊断。真实服务 Key
                  由本地服务持有。
                </p>
                <div className="actions">
                  {launch}
                  <button
                    disabled={busy || !s?.cli_pid}
                    onClick={() => run("cs_stop")}
                  >
                    关闭 Claude 终端
                  </button>
                  <button
                    disabled={busy || !s?.proxy_running}
                    onClick={() => run("cs_disconnect")}
                  >
                    断开连接
                  </button>
                </div>
                <p>
                  已转发请求 {s?.requests || 0} ·{" "}
                  {s?.cli_pid ? `终端 PID ${s.cli_pid}` : "终端未运行"}
                </p>
              </section>
            </>
          )}
          {page === 2 && (
            <>
              <section>
                <div className="section-head">
                  <h2>环境检查</h2>
                  <button
                    disabled={busy || !s?.network}
                    onClick={() => run("cs_diagnose")}
                  >
                    重新检测
                  </button>
                </div>
                <p>
                  检查指定代理、出口、DNS、IPv6 及适用的 UDP 路径。当前非 API
                  进程流量尚无网络层保护证据。
                </p>
                {s?.network && (
                  <small>
                    预期出口 {s.network.expected_egress} · 配置版本{" "}
                    {s.network.revision.slice(0, 12)}
                  </small>
                )}
                {!report ? (
                  <p>激活服务后点击检测。未检测不代表正常。</p>
                ) : (
                  <>
                    <div className="summary">
                      API 检查：
                      {checks[report.apiProtection] || report.apiProtection} ·
                      非 API：未覆盖
                    </div>
                    {report.checks.map((c) => (
                      <article className={`check ${c.status}`} key={c.id}>
                        <div className="section-head">
                          <strong>{c.label}</strong>
                          <span>{checks[c.status] || c.status}</span>
                        </div>
                        <p>{c.detail}</p>
                        {c.evidence && <code>{c.evidence}</code>}
                        {c.remediation && <small>建议：{c.remediation}</small>}
                      </article>
                    ))}
                  </>
                )}
              </section>
              <section>
                <h2>修复与恢复</h2>
                <p>
                  仅修改受管的 Claude API 字段，保留加密备份；系统 DNS、IPv6
                  和防火墙不会被此操作修改。
                </p>
                {config}
              </section>
            </>
          )}
          {page === 3 && (
            <section>
              <h2>平台计量</h2>
              <div className="actions">
                <label>
                  开始日期
                  <input
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                  />
                </label>
                <label>
                  结束日期
                  <input
                    type="date"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </label>
                <button
                  disabled={
                    busy || !s?.logged_in || !start || !end || start > end
                  }
                  onClick={() => run("cs_usage", { start, end })}
                >
                  查询用量
                </button>
              </div>
              <div className="metrics">
                {[
                  ["请求数量", "total_requests"],
                  ["总 Token", "total_tokens"],
                  ["Input Token", "total_input_tokens"],
                  ["Output Token", "total_output_tokens"],
                  ["Cache Token", "total_cache_tokens"],
                  ["实际扣除额度", "total_actual_cost"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <small>{k}</small>
                    <strong>{num(usage?.[v])}</strong>
                  </div>
                ))}
              </div>
              <p>
                5h / 1w
                官方窗口及逐会话统计：当前服务接口未提供，不能从平台用量推算。
              </p>
            </section>
          )}
          {page === 4 && (
            <>
              <section>
                <h2>连接设置</h2>
                <label>
                  服务端地址
                  <input
                    type="url"
                    value={s?.server || server}
                    disabled={s?.logged_in}
                    onChange={(e) => setServer(e.target.value)}
                  />
                </label>
                <label>
                  用户 Portal 地址
                  <input
                    type="url"
                    value={portal}
                    onChange={(e) => setPortal(e.target.value)}
                  />
                </label>
                <div className="actions">
                  <button
                    onClick={() => {
                      localStorage.setItem("cs.portal", portal);
                      localStorage.setItem("cs.server", server);
                      setNotice("连接设置已保存");
                    }}
                  >
                    保存设置
                  </button>
                  {portalButton}
                </div>
                <p>
                  远端服务使用 HTTPS；HTTP
                  仅支持本机测试。更换服务端请先退出登录。
                </p>
              </section>
              <section>
                <h2>账号与备份</h2>
                <p>
                  退出登录会关闭受管终端、断开代理并恢复原 Claude API
                  配置；字段冲突时保留加密备份并提示处理。
                </p>
                <div className="actions">
                  <button
                    disabled={busy || !s?.logged_in}
                    onClick={() => run("cs_logout")}
                  >
                    退出登录并恢复配置
                  </button>
                  <button
                    disabled={busy || !!s?.cli_pid}
                    onClick={() => run("cs_restore")}
                  >
                    恢复原配置
                  </button>
                </div>
              </section>
              <section>
                <h2>关于 CodeSeam</h2>
                <p>Windows MVP · 0.5.0</p>
                <small>
                  基于 Z-Switch（MIT）与
                  Sub2API（LGPL-3.0）。安装目录附带许可和源码说明。关闭客户端会停止受管终端与代理；会话加密保留供重启恢复。
                </small>
              </section>
            </>
          )}
        </main>
        <footer>
          <div>
            <i className={s?.proxy_running ? "online" : ""} />
            <strong>
              {s?.proxy_running ? "本地连接已就绪" : "等待连接服务"}
            </strong>
            <small>启动前自动诊断 · 非 API 网络保护未验证</small>
          </div>
          {launch}
        </footer>
      </div>
    </div>
  );
}

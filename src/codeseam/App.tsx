import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./style.css";
import codeseamLogo from "./assets/codeseam-logo.svg";

type Service = { id: number; name: string; state: string; expires_at: string | null };
type Status = { logged_in: boolean; server?: string; services: Service[]; service_id?: number; proxy_running: boolean; configured: boolean; cli?: string; cli_pid?: number; local_url: string; network?: { revision: string; expected_egress: string; protocol: string }; requests?: number };
type Check = { id: string; label: string; status: string; detail: string; evidence?: string; protected: boolean; remediation?: string };
type NetworkReport = { generatedAt: number; checks: Check[]; canStart: boolean; apiProtection: string; nonApiCoverage: string };

const statusText: Record<string, string> = { pass: "PASS", warning: "非 PASS · 警告", fail: "非 PASS · 失败", unknown: "无法确认", not_applicable: "不适用" };

export default function App() {
  const [status, setStatus] = useState<Status>();
  const [server, setServer] = useState("http://127.0.0.1:18081");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [report, setReport] = useState<NetworkReport>();
  const refresh = async () => setStatus(await invoke<Status>("cs_status"));
  const diagnose = async () => {
    try { setReport(await invoke<NetworkReport>("cs_diagnose")); }
    catch (e) { setError(String(e)); }
  };
  async function run(command: string, args?: Record<string, unknown>) {
    setBusy(true); setError(""); setNotice("");
    try {
      await invoke(command, args);
      await refresh();
      if (command !== "cs_disconnect" && command !== "cs_logout") await diagnose();
      else setReport(undefined);
      setNotice("操作已完成");
    }
    catch (e) { setError(String(e)); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  }
  useEffect(() => { run("cs_resume"); const timer = setInterval(() => refresh().catch(() => {}), 3000); return () => clearInterval(timer); }, []);
  return <main>
    <header><div className="brand"><img className="brand-logo" src={codeseamLogo} alt="CodeSeam" /><span>CodeSeam</span></div><span className="badge">Windows · P3 开发版</span></header>
    <h1>连接你的编程服务</h1>
    <p className="intro">登录、激活服务，然后通过本地受管连接使用 Claude Code。</p>
    {error && <div role="alert" className="error">{error}</div>}
    {notice && <div role="status" className="notice">{notice}</div>}
    <section>
      <h2>1 · 登录 CodeSeam</h2>
      {status?.logged_in ? <div className="row"><span>已登录 · {status.server}</span><button disabled={busy} onClick={() => run("cs_logout")}>退出登录</button></div> :
        <form onSubmit={e => { e.preventDefault(); const p = password; setPassword(""); run("cs_login", { server, email, password: p }); }}>
          <label>服务地址<input value={server} onChange={e => setServer(e.target.value)} type="url" required /></label>
          <div className="fields"><label>邮箱<input autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} type="email" required /></label>
            <label>密码<input autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} type="password" required /></label></div>
          <button className="primary" disabled={busy}>登录</button>
        </form>}
    </section>
    <section>
      <div className="row"><h2>2 · 选择已授权服务</h2><button disabled={busy || !status?.logged_in} onClick={() => run("cs_refresh")}>刷新服务 / 重新连接</button></div>
      {!status?.services.length ? <p>暂无可用服务。登录后若仍为空，请联系运营分配服务。</p> : status.services.map(s => <div className="service" key={s.id}>
        <div><strong>{s.name}</strong><p>授权：{s.state} · 到期：{s.expires_at ? new Date(s.expires_at).toLocaleString() : "未设置"}</p></div>
        <button disabled={busy || s.state !== "ACTIVE"} onClick={() => run("cs_activate", { id: s.id })}>{status.service_id === s.id && status.proxy_running ? "已激活" : "激活"}</button>
      </div>)}
      <div className="connection"><i className={status?.proxy_running ? "online" : ""} />{status?.proxy_running ? "本地代理运行中" : "本地代理未连接"} · {status?.local_url || "http://127.0.0.1:18899/claude"}</div>
      <p className="subtle">授权有效不代表上游健康；实际请求结果由云端 Gateway 决定。已转发请求：{status?.requests || 0}</p>
      {status?.network && <p className="subtle">已领取服务网络配置 · {status.network.protocol} · 预期出口 {status.network.expected_egress}<br />配置版本 {status.network.revision.slice(0, 12)} · 诊断结果以实际探针为准。</p>}
      <button disabled={busy || !status?.proxy_running} onClick={() => run("cs_disconnect")}>断开本地代理</button>
    </section>
    <section>
      <h2>3 · 配置并启动 Claude Code</h2>
      <p>{status?.cli ? `已检测到：${status.cli}` : "未检测到 Claude Code，请先安装官方 CLI。"}</p>
      <p>CLI 配置：{status?.configured ? "localhost 占位授权已配置" : "尚未配置，或受管字段发生变化"}</p>
      <label className="consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />我确认加密备份当前配置，并仅更改 Claude 的 API 地址及授权字段为 localhost 占位值。</label>
      <div className="actions">
        <button disabled={busy || !consent || !status?.proxy_running} onClick={() => run("cs_configure", { confirmed: consent })}>备份并配置</button>
        <button className="primary" disabled={busy || !status?.cli || !status.configured || !status.proxy_running || !!status.cli_pid} onClick={() => run("cs_launch")}>启动 Claude Code</button>
        <button disabled={busy || !status?.cli_pid} onClick={() => run("cs_stop")}>关闭 Claude 终端</button>
        <button disabled={busy || !!status?.cli_pid} onClick={() => run("cs_restore")}>恢复原配置</button>
      </div>
    </section>
    <section className="diagnostics">
      <div className="row"><div><h2>4 · 网络环境诊断与断线保护</h2><p className="subtle">探针会真实访问出口地址、解析服务主机并检查 UDP；结果只代表已显示的路径。</p></div><button disabled={busy || !status?.network} onClick={diagnose}>重新检测</button></div>
      {!report ? <p>激活服务后运行检测。未运行检测前不显示正常状态。</p> : <>
        <div className={`summary summary-${report.apiProtection}`}><strong>API 保护：{statusText[report.apiProtection] || report.apiProtection}</strong><span>非 API 流量：未覆盖（{report.nonApiCoverage}）</span></div>
        <div className="checks">{report.checks.map(check => <div className={`check check-${check.status}`} key={check.id}>
          <div className="check-head"><strong>{check.label}</strong><span>{statusText[check.status] || check.status}</span></div>
          <p>{check.detail}</p>
          {check.evidence && <code>{check.evidence}</code>}
          {check.remediation && <small>建议：{check.remediation}</small>}
        </div>)}</div>
        <p className="subtle">“PASS”只表示该条证据满足当前检查；DNS 远端解析、UDP/WebRTC 和 Claude Code 非 API 路径没有被 HTTP 代理自动证明。</p>
        <div className="actions"><button disabled={busy || !status?.proxy_running} onClick={() => run("cs_repair_environment", { confirmed: true })}>备份并修复受管配置</button><button disabled={busy || !!status?.cli_pid} onClick={() => run("cs_restore")}>恢复原始配置</button></div>
      </>}
    </section>
    <footer>关闭客户端会停止本地 API 代理；重启后会重新验证授权。独享 API 路由由云端校验。网络配置领取不代表实际出口一致或系统网络防泄漏已通过。<br />基于 Z-Switch（MIT）与 Sub2API（LGPL-3.0），保留原项目许可。</footer>
  </main>;
}

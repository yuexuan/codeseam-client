import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./style.css";

type Service = { id: number; name: string; state: string; expires_at: string | null };
type Status = { logged_in: boolean; server?: string; services: Service[]; service_id?: number; proxy_running: boolean; configured: boolean; cli?: string; cli_pid?: number; local_url: string; requests?: number };

export default function App() {
  const [status, setStatus] = useState<Status>();
  const [server, setServer] = useState("http://127.0.0.1:18081");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const refresh = async () => setStatus(await invoke<Status>("cs_status"));
  async function run(command: string, args?: Record<string, unknown>) {
    setBusy(true); setError(""); setNotice("");
    try { await invoke(command, args); await refresh(); setNotice("操作已完成"); }
    catch (e) { setError(String(e)); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  }
  useEffect(() => { run("cs_resume"); const timer = setInterval(() => refresh().catch(() => {}), 3000); return () => clearInterval(timer); }, []);
  return <main>
    <header><div className="brand">C<span>CodeSeam</span></div><span className="badge">Windows · P1 开发版</span></header>
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
    <footer>关闭客户端会停止本地 API 代理；重启后会重新验证授权。开发版仅验证 API 连接，不声明独享出口或系统网络防泄漏能力。<br />基于 Z-Switch（MIT）与 Sub2API（LGPL-3.0），保留原项目许可。</footer>
  </main>;
}

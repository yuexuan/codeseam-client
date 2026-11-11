import { useEffect, useRef, useState } from "react";
import { ExternalLink, LogIn, X } from "lucide-react";
import type { CodeSeam } from "../lib/useCodeSeam";
import { Button } from "./ui/Button";

export function LoginDialog({ cs, open, onClose }: {
  cs: CodeSeam;
  open: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (open) {
      setSubmitted(false);
      dialog.current?.showModal();
      emailInput.current?.focus();
    } else {
      dialog.current?.close();
      setPassword("");
    }
  }, [open]);

  useEffect(() => {
    if (open && cs.status?.logged_in) onClose();
  }, [open, cs.status?.logged_in, onClose]);

  return (
    <dialog ref={dialog} className="login-dialog" aria-labelledby="login-title"
      aria-describedby="login-description" onCancel={onClose}>
      <div className="login-dialog-heading">
        <span className="login-dialog-icon"><LogIn size={22} /></span>
        <button type="button" className="icon-btn" aria-label="关闭登录窗口" onClick={onClose}><X /></button>
      </div>
      <h2 id="login-title">登录 CodeSeam</h2>
      <p id="login-description">连接你的编程服务。本地环境检测无需登录即可使用。</p>
      {submitted && cs.error && <div className="error" role="alert">{cs.error}</div>}
      <form className="login-dialog-form" onSubmit={(event) => {
        event.preventDefault();
        if (cs.busy) return;
        setSubmitted(true);
        const secret = password;
        setPassword("");
        void cs.run("cs_login", { server: cs.server, email: cs.email, password: secret });
      }}>
        <label htmlFor="login-email">邮箱
          <input ref={emailInput} id="login-email" type="email" autoComplete="username" required
            value={cs.email} onChange={event => cs.setEmail(event.target.value)} disabled={cs.busy} />
        </label>
        <label htmlFor="login-password">密码
          <input id="login-password" type="password" autoComplete="current-password" required
            value={password} onChange={event => setPassword(event.target.value)} disabled={cs.busy} />
        </label>
        <details className="login-connection">
          <summary>连接设置</summary>
          <label htmlFor="login-server">服务端地址
            <input id="login-server" type="url" required value={cs.server}
              onChange={event => cs.setServer(event.target.value)} disabled={cs.busy} />
          </label>
        </details>
        <Button type="submit" variant="primary" disabled={cs.busy}>
          {cs.busy ? "正在登录…" : "登录"}
        </Button>
      </form>
      <div className="login-dialog-footer">
        <span>注册与找回密码</span>
        <Button type="button" size="sm" variant="ghost" icon={<ExternalLink size={13} />}
          disabled={cs.busy || !cs.portal} onClick={() => void cs.run("cs_open_portal", { url: cs.portal })}>
          用户服务门户
        </Button>
      </div>
    </dialog>
  );
}

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { CodeSeam } from "../lib/useCodeSeam";
import { Button } from "./ui/Button";

/** 受管配置块：备份确认 + 配置/恢复按钮。Claude Code 页与环境诊断页共用。 */
export function ManagedConfig({ cs }: { cs: CodeSeam }) {
  const [consent, setConsent] = useState(false);
  const { status, busy } = cs;
  return (
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
        <Button
          icon={<ShieldCheck size={14} />}
          disabled={busy || !consent || !status?.proxy_running}
          onClick={() => void cs.run("cs_configure", { confirmed: consent })}
        >
          备份并配置
        </Button>
        <Button disabled={busy || !!status?.cli_pid} onClick={() => void cs.run("cs_restore")}>
          恢复原配置
        </Button>
      </div>
    </>
  );
}
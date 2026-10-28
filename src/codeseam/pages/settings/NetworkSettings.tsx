import { useState } from "react";
import { ShieldAlert, Stethoscope, Wrench } from "lucide-react";
import type { CodeSeam } from "../../lib/useCodeSeam";
import type { PageId } from "../../lib/types";
import { checkText, fullTime } from "../../lib/format";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { SettingGroup, SettingRow } from "../../components/ui/SettingRow";

const tone = (s?: string) =>
  s === "pass" ? "green" : s === "fail" ? "red" : s === "warning" || s === "unknown" ? "amber" : "neutral";

/** 网络与环境：固定的保护策略（只读事实）、最近一次检测结论、受确认的环境修复。 */
export function NetworkSettings({
  cs,
  setPage,
}: {
  cs: CodeSeam;
  setPage: (p: PageId) => void;
}) {
  const { status, report, busy } = cs;
  const [consent, setConsent] = useState(false);
  const loggedIn = !!status?.logged_in;
  const counts = { pass: 0, issue: 0, unknown: 0 };
  for (const c of report?.checks ?? []) {
    if (c.status === "pass" || c.status === "not_applicable") counts.pass++;
    else if (c.status === "fail" || c.status === "warning") counts.issue++;
    else counts.unknown++;
  }
  return (
    <>
      <SettingGroup
        title="保护策略"
        subtitle="以下策略由客户端固定执行，不提供关闭开关——降级为直连会让专属出口失去意义。"
      >
        <SettingRow title="失联即阻断（Kill-Switch）" desc="本地代理或上游代理不可用时，受保护的 API 请求直接失败。">
          <Badge tone="green">始终开启</Badge>
        </SettingRow>
        <SettingRow title="启动前网络检测" desc="每次启动 Claude Code 前检测；存在会导致直连的失败项时拒绝启动。">
          <Badge tone="green">始终执行</Badge>
        </SettingRow>
        <SettingRow title="直连降级" desc="转发失败时不会静默切换为直连或其他出口。">
          <Badge tone="green">已禁止</Badge>
        </SettingRow>
        <SettingRow
          title="非 API 流量"
          desc="受管终端通过进程环境变量使用专属代理（尽力而为）；尚未做网络层强制，不宣称已全面覆盖。"
        >
          <Badge tone="amber">未验证</Badge>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="最近检测" subtitle="来自环境诊断页的最近一次结果。">
        {report ? (
          <>
            <SettingRow title="API 请求保护" desc={`检测时间 ${fullTime((report.generatedAt ?? 0) * 1000)}`}>
              <Badge tone={tone(report.apiProtection)}>
                {checkText[report.apiProtection] ?? report.apiProtection}
              </Badge>
            </SettingRow>
            <SettingRow title="检测项汇总" desc={`共 ${report.checks.length} 项`}>
              <span className="set-value">
                正常 {counts.pass} · 待处理 {counts.issue} · 待验证 {counts.unknown}
              </span>
            </SettingRow>
            <SettingRow title="可启动 Claude Code" desc="没有会导致受保护 API 直连的失败项时为“是”。">
              <Badge tone={report.canStart ? "green" : "red"}>{report.canStart ? "是" : "否"}</Badge>
            </SettingRow>
          </>
        ) : (
          <p className="set-empty">
            {loggedIn ? "本次运行尚未检测，点击下方按钮开始。" : "登录并连接服务后可进行环境检测。"}
          </p>
        )}
        <div className="set-actions">
          <Button
            icon={<Stethoscope size={14} />}
            disabled={busy || !loggedIn}
            onClick={() => void cs.run("cs_diagnose")}
          >
            立即检测
          </Button>
          <Button icon={<ShieldAlert size={14} />} onClick={() => setPage("diagnostics")}>
            查看诊断详情
          </Button>
        </div>
      </SettingGroup>

      <SettingGroup
        title="环境修复"
        subtitle="只修复受管的 Claude API 字段；系统 DNS、IPv6、防火墙等不会被此操作修改。"
      >
        <label className="consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          我了解：将备份原配置，并把 API 地址与授权改回本地受管字段。
        </label>
        <div className="set-actions">
          <Button
            icon={<Wrench size={14} />}
            disabled={busy || !consent || !status?.proxy_running}
            onClick={() => void cs.run("cs_repair_environment", { confirmed: consent })}
          >
            修复受管配置
          </Button>
        </div>
        {!status?.proxy_running && <p className="set-note">本地代理未运行，已禁用修复以避免写入会导致直连的配置。</p>}
      </SettingGroup>
    </>
  );
}

import { CalendarClock, Coins, ExternalLink, Gauge, RefreshCw, ShieldCheck } from "lucide-react";
import { daysLeft, date, stateText } from "../../lib/format";
import { money } from "../../lib/usage";
import type { UsageReport } from "../../lib/types";
import type { CodeSeam } from "../../lib/useCodeSeam";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Progress } from "../../components/ui/Progress";
import { UsageStat } from "../../components/usage/UsageStat";

const tone = (state: string) =>
  state === "ACTIVE" ? "green" : state === "NOT_STARTED" || state === "NOT_PROVISIONED" ? "amber" : "red";

/** 配额管理：服务套餐的有效期与平台额度，及 5h / 1w 官方窗口的数据边界说明。 */
export function UsageQuota({ cs, report }: { cs: CodeSeam; report?: UsageReport }) {
  const { service, status, busy } = cs;
  const quota = service?.quota;
  const used = service?.quota_used;
  const hasQuota = quota != null && quota > 0 && used != null;
  const left = daysLeft(service?.expires_at);
  const others = (status?.services ?? []).filter((s) => s.id !== service?.id);

  return (
    <>
      <div className="usage-stats">
        <UsageStat
          icon={<ShieldCheck size={18} />}
          label="服务状态"
          value={service ? (stateText[service.state] ?? service.state) : "未激活"}
          sub={service ? service.name : "登录后自动领取服务"}
        />
        <UsageStat
          icon={<CalendarClock size={18} />}
          label="剩余有效期"
          value={left != null ? `${left} 天` : "未提供"}
          sub={service?.expires_at ? `到期 ${date(service.expires_at)}` : undefined}
        />
        <UsageStat
          icon={<Gauge size={18} />}
          label="平台额度剩余"
          value={hasQuota ? money(Math.max(0, quota - used)) : "不限 / 未提供"}
          percent={hasQuota ? (used / quota) * 100 : undefined}
          percentText={hasQuota ? `已用 ${((used / quota) * 100).toFixed(1)}%` : undefined}
          sub={hasQuota ? `共 ${money(quota)}` : "服务未设置额度上限"}
        />
        <UsageStat
          icon={<Coins size={18} />}
          label="所选区间已扣除"
          value={report ? money(report.stats.total_actual_cost ?? 0) : "—"}
          sub={report ? `${report.start} 至 ${report.end}` : "区间用量加载后显示"}
        />
      </div>

      <div className="usage-row usage-row--even">
        <Card
          title="当前服务"
          subtitle="数据来自服务端，登录与激活后自动同步。"
          action={
            <Button size="sm" icon={<RefreshCw size={13} />} disabled={busy || !status?.logged_in} onClick={() => void cs.run("cs_refresh")}>
              同步服务信息
            </Button>
          }
        >
          {service ? (
            <>
              <dl className="usage-kv">
                <dt>服务名称</dt>
                <dd>
                  {service.name} <Badge tone={tone(service.state)}>{stateText[service.state] ?? service.state}</Badge>
                </dd>
                <dt>到期时间</dt>
                <dd>{date(service.expires_at)}</dd>
                <dt>本地代理</dt>
                <dd>{status?.proxy_running ? "运行中" : "未运行"}</dd>
              </dl>
              {hasQuota ? (
                <Progress
                  label="平台额度"
                  used={used}
                  total={quota}
                  hint={`剩余 ${money(Math.max(0, quota - used))}；额度由服务端按真实计量扣除。`}
                />
              ) : (
                <p className="usage-note">当前服务未设置额度上限，用量按实际计量统计。</p>
              )}
              <div className="actions">
                <Button icon={<ExternalLink size={14} />} onClick={() => void cs.run("cs_open_portal", { url: cs.portal })}>
                  打开服务门户（续费 / 联系运营）
                </Button>
              </div>
            </>
          ) : (
            <p className="table-empty">尚未获取到服务，请先在概览页登录并激活。</p>
          )}
          {others.length > 0 && (
            <>
              <h3 className="usage-sub">其他服务</h3>
              <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>状态</th>
                    <th>到期</th>
                    <th className="num">额度已用</th>
                  </tr>
                </thead>
                <tbody>
                  {others.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>{stateText[s.state] ?? s.state}</td>
                      <td>{date(s.expires_at)}</td>
                      <td className="num">{s.quota ? `${money(s.quota_used ?? 0)} / ${money(s.quota)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </Card>

        <Card title="数据口径说明" subtitle="避免把平台计量误读为官方额度。">
          <ul className="usage-notes">
            <li>
              <strong>平台计量用量</strong>
              <span>由 CodeSeam 服务端逐请求记录，是本页全部 Token 与费用的来源。</span>
            </li>
            <li>
              <strong>平台套餐额度</strong>
              <span>服务设置了额度上限时才显示，用量与剩余按平台计量扣除。</span>
            </li>
            <li>
              <strong>5 小时 / 每周官方窗口</strong>
              <span>Anthropic 官方的滚动窗口与周额度，当前服务接口没有提供，客户端不会用平台用量去推算，也不显示此类进度。</span>
            </li>
            <li>
              <strong>额度不足或到期</strong>
              <span>服务端会拒绝请求并给出原因；到期后可通过服务门户续费，续费后客户端无需重新安装。</span>
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}

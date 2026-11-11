import { Stethoscope } from "lucide-react";
import type { CodeSeam } from "../../lib/useCodeSeam";
import type { DiagnosticsTab, PageId } from "../../lib/types";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { SettingGroup, SettingRow } from "../../components/ui/SettingRow";

/** 设置只保留保护策略说明；检测、编辑、应用和恢复统一进入环境诊断。 */
export function NetworkSettings({ cs, setPage }: { cs: CodeSeam; setPage: (p: PageId) => void }) {
  const open = (tab: DiagnosticsTab) => { cs.setDiagnosticsTab(tab); setPage("diagnostics"); };
  return <>
    <SettingGroup title="保护策略">
      <SettingRow title="API 失联即阻断" desc="转发失败时拒绝受管 API 请求，不静默降级为直连。"><Badge tone="neutral">固定策略</Badge></SettingRow>
      <SettingRow title="启动前检测" desc="每次受管启动重新检查；失败时按实际检查结果阻止启动。"><Badge tone="neutral">固定策略</Badge></SettingRow>
      <SettingRow title="非 API 流量" desc="环境变量代理不等于网络层强制保护；尚不宣称全面覆盖。"><Badge tone="amber">未覆盖</Badge></SettingRow>
    </SettingGroup>
    <SettingGroup title="环境诊断与配置" subtitle="按对象查看真实检测结果，并在独立配置区域审阅和应用变更。">
      <div className="set-actions"><Button icon={<Stethoscope size={14} />} onClick={() => open("network")}>代理与网络</Button>
        <Button onClick={() => open("claude")}>Claude API 配置</Button><Button onClick={() => open("recovery")}>配置恢复与报告</Button></div>
    </SettingGroup>
  </>;
}

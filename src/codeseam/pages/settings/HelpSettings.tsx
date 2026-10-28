import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import type { CodeSeam } from "../../lib/useCodeSeam";
import type { PageId } from "../../lib/types";
import { checkText, stateText } from "../../lib/format";
import { Button } from "../../components/ui/Button";
import { SettingGroup, SettingRow } from "../../components/ui/SettingRow";

const FAQ: [string, string][] = [
  [
    "登录后提示“云端不可达”，是账号失效了吗？",
    "不是。“云端不可达”说明客户端联系不上服务端，与账号状态无关。请检查网络与“代理设置”里的服务端地址；服务到期、停用会显示明确的状态文案。",
  ],
  [
    "为什么启动 Claude Code 前要先做环境检测？",
    "CodeSeam 保证请求经你的专属出口发出。检测发现会导致受保护请求直连的问题（本地代理未运行、出口不一致、配置被改动等）时会拒绝启动，修复后重新检测即可。",
  ],
  [
    "CodeSeam 改了我的 Claude Code 配置吗？",
    "只改写 settings.json 的 API 地址与授权两个字段，改动前会加密备份原配置。“恢复原配置”或退出登录时还原这两个字段，其他设置不受影响。",
  ],
  [
    "代理断开后会自动走直连吗？",
    "不会。本地代理、上游代理或必要路由失效时，受保护的 API 请求直接失败（Kill-Switch），恢复并重新检测后才放行。",
  ],
  [
    "非 API 流量（如自动更新）也受保护吗？",
    "受管终端会通过环境变量使用专属代理，但这不是网络层强制，环境诊断页会把这一项标为“待验证”。客户端只声明已验证的覆盖范围。",
  ],
  [
    "关闭窗口后代理还在运行吗？",
    "在“应用设置”里选择关闭时最小化到托盘时，代理与受管终端继续运行；从托盘菜单选择退出，或关闭该选项后点击关闭，会停止代理与受管终端。",
  ],
  [
    "用量与官方剩余额度为什么对不上？",
    "用量页展示的是服务端的平台计量与套餐额度，并不等同于上游账号的官方 5 小时 / 每周额度，客户端不会用它去推算官方窗口。",
  ],
];

/** 帮助与反馈：常见问题、反馈入口，以及可复制的脱敏诊断信息。 */
export function HelpSettings({
  cs,
  setPage,
}: {
  cs: CodeSeam;
  setPage: (p: PageId) => void;
}) {
  const { status, service, report, cliInfo } = cs;
  const [copied, setCopied] = useState(false);

  const copyInfo = async () => {
    const version = await getVersion().catch(() => "0.5.0");
    const lines = [
      `CodeSeam v${version}（Windows MVP）`,
      `登录：${status?.logged_in ? "是" : "否"}；服务：${service ? `${service.name} / ${stateText[service.state] ?? service.state}` : "无"}`,
      `本地代理：${status?.proxy_running ? "运行中" : "未运行"}；Claude 配置：${status?.configured ? "已指向本地代理" : "未配置"}`,
      `Claude Code：${status?.cli ? `已安装${cliInfo?.version ? ` ${cliInfo.version}` : ""}` : "未检测到"}`,
      `API 请求保护：${report ? (checkText[report.apiProtection] ?? report.apiProtection) : "未检测"}`,
      ...(report?.checks ?? []).map((c) => `  - ${c.label}：${checkText[c.status] ?? c.status}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 剪贴板不可用时不提示成功。 */
    }
  };

  return (
    <>
      <SettingGroup title="常见问题">
        {FAQ.map(([q, a]) => (
          <details className="faq" key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </SettingGroup>
      <SettingGroup title="反馈与支持" subtitle="遇到问题时，请把诊断信息一并发给服务运营人员。">
        <SettingRow title="复制诊断信息" desc="版本、服务状态与检测结论的摘要，不含密钥、令牌与代理凭据。">
          <Button size="sm" icon={<Copy size={13} />} onClick={() => void copyInfo()}>
            {copied ? "已复制" : "复制"}
          </Button>
        </SettingRow>
        <SettingRow title="运行环境诊断" desc="先自行定位网络、代理与配置问题。">
          <Button size="sm" onClick={() => setPage("diagnostics")}>
            打开环境诊断
          </Button>
        </SettingRow>
        <SettingRow title="用户服务门户" desc="查看服务期限与用量、续费，或联系运营。">
          <Button
            size="sm"
            icon={<ExternalLink size={13} />}
            disabled={cs.busy || !cs.portal}
            onClick={() => void cs.run("cs_open_portal", { url: cs.portal })}
          >
            打开
          </Button>
        </SettingRow>
      </SettingGroup>
    </>
  );
}

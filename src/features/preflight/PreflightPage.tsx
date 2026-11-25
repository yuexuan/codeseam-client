import { WizardHeader } from '../../components/layout/WizardHeader';
import {
  Monitor,
  Layers,
  Wifi,
  Settings,
  Globe,
  Clock,
  Languages,
  Terminal,
  AppWindow,
  Cpu,
  Router,
  CircleHelp,
  LoaderCircle,
  Info,
  RotateCw,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Group, Report } from '../../bindings/commands';
import { Button } from '../../components/ui/Button';
import { Surface } from '../../components/ui/Surface';
import { CheckRow } from '../../components/business/CheckRow';
import { DetectionSummary } from '../../components/business/DetectionSummary';
import { summarize } from './model';
import styles from './PreflightPage.module.css';
const groups: {
  id: Group;
  label: string;
  icon: LucideIcon;
  primary: string[];
}[] = [
  {
    id: 'system',
    label: '基础系统',
    icon: Monitor,
    primary: ['windows', 'timezone', 'language'],
  },
  {
    id: 'apps',
    label: 'Claude 全家桶',
    icon: Layers,
    primary: ['browser', 'code', 'desktop'],
  },
  {
    id: 'network',
    label: '网络与代理',
    icon: Wifi,
    primary: ['connection', 'nodes', 'proxy'],
  },
  { id: 'runtime', label: '可选运行能力', icon: Settings, primary: ['hyperv'] },
];
const icons: Record<string, LucideIcon> = {
  windows: Monitor,
  timezone: Clock,
  language: Languages,
  browser: AppWindow,
  code: Terminal,
  desktop: Monitor,
  connection: Globe,
  nodes: Router,
  proxy: Layers,
  hyperv: Cpu,
};
export function PreflightPage({
  report,
  scanning,
  error,
  onRefresh,
}: {
  report: Report | undefined;
  scanning: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const summary = report ? summarize(report) : null;
  return (
    <>
      <WizardHeader
        title="环境预检"
        description={<> 检查这台电脑是否已准备好运行 Claude 全家桶 </>}
      >
        <Button
          variant="icon"
          aria-label="重新检测"
          disabled={scanning}
          onClick={onRefresh}
        >
          <RotateCw size={23} />
        </Button>
      </WizardHeader>
      <DetectionSummary
        state={
          scanning
            ? 'scanning'
            : error
              ? 'error'
              : report
                ? 'completed'
                : 'idle'
        }
        title={
          scanning
            ? '正在检查运行环境'
            : error
              ? '本次检查未完成'
              : report
                ? '基础检查已完成'
                : '准备检查运行环境'
        }
        description={
          error ||
          (scanning
            ? '正在读取系统基础信息'
            : summary?.pending
              ? '部分项目需配置，接下来将逐项完成准备'
              : '接下来将添加代理节点，选择当前使用的出口')
        }
        counts={summary ?? undefined}
        completeLabel="已完成初步检测"
        stale={!!report && (scanning || !!error)}
      />
      <div className={styles.grid}>
        {groups.map((group) => {
          const items = report
            ? report.checks.filter((item) => item.group === group.id)
            : [];
          const primary = group.primary.flatMap((id) =>
            items.filter((item) => item.id === id),
          );
          return (
            <Surface key={group.id} className={styles.card}>
              <h2>
                <group.icon size={25} aria-hidden="true" />
                {group.label}
              </h2>
              <div className={styles.rows}>
                {report ? (
                  primary.map((item) => (
                    <CheckRow
                      key={item.id}
                      compact
                      icon={icons[item.id] ?? Info}
                      label={item.label}
                      value={item.value}
                      status={item.status}
                    />
                  ))
                ) : (
                  <div className={styles.waiting}>
                    {error ? (
                      <CircleHelp size={19} />
                    ) : (
                      <LoaderCircle size={19} />
                    )}{' '}
                    {error
                      ? '本次未取得结果'
                      : scanning
                        ? '正在检测…'
                        : '等待检测'}
                  </div>
                )}
              </div>
              {group.id === 'runtime' && (
                <p className={styles.runtimeNote}>可在运行环境步骤中设置</p>
              )}
            </Surface>
          );
        })}
      </div>
      {summary && summary.blockers.length > 0 && (
        <p role="alert" className={styles.notice}>
          无法继续：{summary.blockers.map((item) => item.detail).join('；')}
        </p>
      )}
    </>
  );
}

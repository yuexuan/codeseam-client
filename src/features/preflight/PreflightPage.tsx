import {
  Check as CheckIcon,
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
  CircleCheck,
  CircleHelp,
  CircleAlert,
  LoaderCircle,
  Info,
  RotateCw,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Check, Group, Report } from '../../bindings/commands';
import { Button } from '../../components/ui/Button';
import { Surface } from '../../components/ui/Surface';
import { StatusLabel } from '../../components/ui/StatusLabel';
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
function CheckRow({ item }: { item: Check }) {
  const Icon = icons[item.id] ?? Info;
  return (
    <div className={styles.row}>
      <Icon className={styles.rowIcon} size={21} aria-hidden="true" />
      <span className={styles.label}>{item.label}</span>
      <span className={styles.value}>{item.value}</span>
      <StatusLabel status={item.status} />
    </div>
  );
}
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
  const Icon = error
    ? CircleAlert
    : scanning || !report
      ? LoaderCircle
      : CheckIcon;
  return (
    <>
      <div className={styles.header}>
        <div>
          <h1>环境预检</h1>
          <p>检查这台电脑是否已准备好运行 Claude 全家桶</p>
        </div>
        <Button
          variant="icon"
          aria-label="重新检测"
          disabled={scanning}
          onClick={onRefresh}
        >
          <RotateCw size={23} />
        </Button>
      </div>
      <Surface className={styles.summary} aria-live="polite">
        <div
          className={`${styles.summaryIcon} ${error ? styles.failed : scanning || !report ? styles.working : ''}`}
        >
          <Icon size={45} aria-hidden="true" />
        </div>
        <div className={styles.summaryText}>
          <h2>
            {scanning
              ? '正在检查运行环境'
              : error
                ? '本次检查未完成'
                : report
                  ? '基础检查已完成'
                  : '准备检查运行环境'}
          </h2>
          <p>
            {error ||
              (scanning
                ? '正在读取系统基础信息'
                : summary?.pending
                  ? '部分项目需配置，接下来将逐项完成准备'
                  : '接下来将添加代理节点，选择当前使用的出口')}
          </p>
          <div className={styles.counts}>
            {summary && !scanning && !error && (
              <>
                <span className={styles.badge}>{summary.pending} 项待处理</span>
                <span className={styles.unknown}>
                  {summary.unknown} 项无法确认
                </span>
                <span className={styles.unknown}>
                  {summary.optional} 项可选
                </span>
                <span className={styles.complete}>
                  <CircleCheck size={18} />
                  已完成初步检测
                </span>
              </>
            )}
            {report && (scanning || error) && (
              <span className={styles.unknown}>下方为上次结果，已过期</span>
            )}
          </div>
        </div>
      </Surface>
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
                  primary.map((item) => <CheckRow key={item.id} item={item} />)
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

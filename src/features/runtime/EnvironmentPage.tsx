import { PanelTitle } from '../../components/layout/PanelTitle';
import { RuntimeIdentity } from '../../components/business/RuntimeIdentity';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Check,
  ChevronRight,
  Cpu,
  ExternalLink,
  Globe,
  Grid2X2,
  HardDrive,
  Layers,
  Link,
  MemoryStick,
  Monitor,
  PanelsTopLeft,
  RefreshCw,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { WorkspaceHeader } from '../../components/layout/WorkspaceHeader';
import { WorkspacePanel } from '../../components/layout/WorkspacePanel';
import { Button } from '../../components/ui/Button';
import { StatusLabel } from '../../components/business/StatusLabel';
import { CheckRow } from '../../components/business/CheckRow';
import { DetailDialog } from '../../components/ui/DetailDialog';
import { Radio } from '../../components/ui/Radio';
import type {
  EnvironmentDetails,
  RuntimeEnvironmentService,
} from '../../services/runtime/environment';
import { formatTime, type WorkbenchRecord } from '../../services/workbench';
import styles from './EnvironmentPage.module.css';

export function EnvironmentPage({
  record,
  service,
  onReconfigure,
  data,
  checking,
  error,
  refresh,
}: {
  record: WorkbenchRecord;
  service: RuntimeEnvironmentService;
  onReconfigure: (record: WorkbenchRecord) => void;
  data?: EnvironmentDetails;
  checking: boolean;
  error?: string | null;
  refresh: () => void;
}) {
  const [switching, setSwitching] = useState(false);
  const [consoleOpened, setConsoleOpened] = useState(false);
  const virtual = record.virtualRuntime;
  const console = useMutation({
    mutationFn: () => service.openConsole(),
    onSuccess: () => setConsoleOpened(true),
  });
  const reconfigure = useMutation({
    mutationFn: () => service.begin(!virtual),
    onSuccess: onReconfigure,
  });
  const loading = checking && !data;
  const busy = checking || console.isPending || reconfigure.isPending;
  const p = record.baseline.profile;
  const unit = (value: number | null | undefined, suffix = ' GB') =>
    value == null ? '待读取' : `${value}${suffix}`;
  const rows = [
    [virtual ? 'Guest 系统' : '操作系统', data?.system],
    ['系统语言', data?.language],
    ['系统时区', data?.timezone],
    [virtual ? '虚拟化平台' : '运行方式', data?.platform],
  ];
  const checks = [
    { id: 'exit', title: virtual ? 'Guest 出口' : '本机出口', icon: Globe },
    { id: 'dns', title: virtual ? 'Guest DNS' : '本机 DNS', icon: Server },
    { id: 'network', title: 'IPv6 / WebRTC', icon: Link },
    { id: 'browser', title: '专用浏览器', icon: PanelsTopLeft },
  ];
  return (
    <div className={styles.page}>
      <WorkspaceHeader title="运行环境">
        <RuntimeIdentity
          runtime={virtual ? 'Virtual' : 'Native'}
          node={p.nodeName}
          exitIp={data?.exitIp ?? '当前出口待检测'}
        />
      </WorkspaceHeader>
      <WorkspacePanel className={styles.hero}>
        <div className={styles.runtimeIcon}>
          <Layers />
          {data?.online && <Check />}
        </div>
        <div className={styles.runtimeCopy}>
          <h2>
            {loading
              ? '正在检测运行环境'
              : virtual
                ? data?.state === 'Running'
                  ? '虚拟机运行中'
                  : data?.state === 'Off'
                    ? '虚拟机已关闭'
                    : data?.state === 'Saved'
                      ? '虚拟机已保存'
                      : data?.state === 'Paused'
                        ? '虚拟机已暂停'
                        : '虚拟机状态待确认'
                : '本机运行环境'}
          </h2>
          <p>
            {virtual ? 'Hyper-V' : 'Native'} · {data?.name ?? '环境信息待读取'}
            {data?.system && ` · ${data.system.split(' · ')[0]}`}
          </p>
        </div>
        <div className={styles.actions}>
          <StatusLabel
            status={
              loading ? 'scanning' : data?.online ? 'satisfied' : 'unknown'
            }
            label={
              virtual
                ? data?.online
                  ? 'Guest 在线'
                  : data
                    ? 'Guest 未连接'
                    : 'Guest 待检测'
                : data?.online
                  ? '本机在线'
                  : '待检测'
            }
          />
          {virtual && (
            <Button
              className={styles.console}
              disabled={busy}
              onClick={() => {
                setConsoleOpened(false);
                console.mutate();
              }}
            >
              <ExternalLink size={17} />
              {console.isPending ? '正在打开…' : '打开虚拟机'}
            </Button>
          )}
          <Button
            className={styles.reconfigure}
            disabled={busy}
            onClick={() => {
              reconfigure.reset();
              setSwitching(true);
            }}
          >
            重新配置运行环境
            <ChevronRight size={17} />
          </Button>
        </div>
      </WorkspacePanel>
      {(error || console.error || data?.error) && (
        <p className={styles.error} role="alert">
          {error ?? console.error?.message ?? data?.error}
        </p>
      )}
      {consoleOpened && (
        <p className={styles.notice} role="status">
          {import.meta.env.DEV && !('__TAURI_INTERNALS__' in window)
            ? '开发预览：已模拟打开虚拟机窗口'
            : '已打开当前虚拟机连接窗口'}
        </p>
      )}
      <div className={styles.columns}>
        <WorkspacePanel
          className={styles.panel}
          role="region"
          aria-label={virtual ? 'Guest 系统' : '本机系统'}
        >
          <PanelTitle>
            <Grid2X2 />
            {virtual ? 'Guest 系统' : '本机系统'}
          </PanelTitle>
          <dl className={styles.system}>
            {rows.map(([title, value]) => (
              <div key={title}>
                <dt>{title}</dt>
                <dd>{value ?? '待读取'}</dd>
              </div>
            ))}
          </dl>
        </WorkspacePanel>
        <WorkspacePanel
          className={styles.panel}
          role="region"
          aria-label={virtual ? '虚拟机资源' : '系统资源'}
        >
          <PanelTitle>
            <Cpu />
            {virtual ? '虚拟机资源' : '系统资源'}
          </PanelTitle>
          <div className={styles.resources}>
            {[
              {
                title: virtual ? '虚拟处理器' : '处理器',
                icon: Cpu,
                value: unit(data?.cpu, virtual ? ' vCPU' : ' 逻辑处理器'),
                detail:
                  data?.cpuUsage == null
                    ? '使用率待检测'
                    : `${virtual ? 'Guest' : 'CPU'} 使用率 ${data.cpuUsage}%`,
              },
              {
                title: virtual ? '虚拟内存' : '系统内存',
                icon: MemoryStick,
                value: unit(data?.memory),
                detail: `${virtual ? 'Guest' : '系统'} 可用 ${unit(data?.memoryAvailable)}`,
              },
              {
                title: virtual ? '虚拟磁盘' : '系统磁盘',
                icon: HardDrive,
                value: unit(data?.disk),
                detail: `${virtual ? 'Guest' : '系统'} 可用 ${unit(data?.diskAvailable)}`,
              },
            ].map(({ title, icon: Icon, value, detail }) => (
              <div key={title}>
                <Icon />
                <span>{title}</span>
                <strong>{value}</strong>
                <small>{detail}</small>
              </div>
            ))}
          </div>
        </WorkspacePanel>
      </div>
      <WorkspacePanel
        className={`${styles.panel} ${styles.validation}`}
        role="region"
        aria-label="环境校验"
      >
        <header>
          <PanelTitle>
            <ShieldCheck />
            环境校验
          </PanelTitle>
          <span>
            当前正式运行环境 · 最近复验{' '}
            {data ? formatTime(data.at) : '尚未完成'}
          </span>
          <Button
            variant="icon"
            aria-label="重新检测运行环境"
            title="重新检测"
            disabled={busy}
            onClick={refresh}
          >
            <RefreshCw size={19} />
          </Button>
        </header>
        <div className={styles.checks}>
          {checks.map(({ id, title, icon: Icon }) => {
            const check = data?.checks.find((item) => item.id === id);
            return (
              <CheckRow
                key={id}
                icon={Icon}
                label={title}
                value={
                  loading
                    ? '正在读取当前环境…'
                    : (check?.value ?? '当前状态待检测')
                }
                status={loading ? 'scanning' : (check?.status ?? 'unknown')}
                statusLabel={check?.label ?? '待检测'}
              />
            );
          })}
          <CheckRow
            icon={ShieldCheck}
            label="正式基线"
            status="satisfied"
            statusLabel="已确认"
            value={
              <>
                v{record.baselineVersion ?? 1}.0 ·{' '}
                {new Date(
                  /^\d+$/.test(record.confirmedAt)
                    ? Number(record.confirmedAt) * 1000
                    : record.confirmedAt,
                ).toLocaleString('zh-CN', { hour12: false })}{' '}
                确认
              </>
            }
          />
        </div>
      </WorkspacePanel>
      {switching && (
        <DetailDialog
          title="切换运行环境"
          closeLabel="取消，保留当前环境"
          locked={reconfigure.isPending}
          onClose={() => setSwitching(false)}
        >
          <p>
            当前使用 {virtual ? 'Virtual · 独立虚拟环境' : 'Native · 本机运行'}
            ，重新配置将切换到：
          </p>
          <label className={styles.target}>
            <Radio
              name="target-runtime"
              value={virtual ? 'native' : 'virtual'}
              checked
              readOnly
            />
            <Monitor />
            <strong>
              {virtual ? 'Native · 本机运行' : 'Virtual · 独立虚拟环境'}
            </strong>
          </label>
          <ul className={styles.impact}>
            <li>运行中的受管 Claude 应用将关闭，请先保存工作。</li>
            <li>
              先备份当前受管配置，再检查和准备目标环境；登录状态不会自动迁移。
            </li>
            <li>
              目标环境通过验证并确认新基线后才正式切换。旧虚拟机、Profile
              和历史基线会保留。
            </li>
          </ul>
          {reconfigure.error && (
            <p role="alert" className={styles.error}>
              {reconfigure.error.message}
            </p>
          )}
          <Button
            disabled={reconfigure.isPending}
            onClick={() => reconfigure.mutate()}
          >
            {reconfigure.isPending ? '正在备份并准备切换…' : '开始重新配置'}
            <ChevronRight size={18} />
          </Button>
        </DetailDialog>
      )}
    </div>
  );
}

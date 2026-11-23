import { useState } from 'react';
import {
  ArrowRight,
  Box,
  Globe,
  Info,
  Monitor,
  Network,
  PanelsTopLeft,
  SlidersHorizontal,
  Terminal,
  UserRound,
} from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Surface } from '../../components/ui/Surface';
import { StatusLabel } from '../../components/ui/StatusLabel';
import { Button } from '../../components/ui/Button';
import { BackButton } from '../../components/ui/BackButton';
import { WizardActions } from '../../components/layout/WizardActions';
import {
  browserReady,
  type BrowserResult,
  type BrowserService,
} from '../../services/browser';
import type {
  WorkbenchRecord,
  WorkbenchService,
} from '../../services/workbench';
import type { ClaudeService } from '../../services/claude';
import styles from './CompletionPage.module.css';

export function CompletionPage({
  result,
  service,
  workbench,
  virtualRuntime,
  onBack,
  onComplete,
  cleanupService,
}: {
  result: BrowserResult;
  service: BrowserService;
  workbench: WorkbenchService;
  virtualRuntime: boolean;
  onBack: () => void;
  onComplete: (record: WorkbenchRecord) => void;
  cleanupService: ClaudeService;
}) {
  const [alias, setAlias] = useState('');
  const [region, setRegion] = useState('');
  const p = result.profile;
  const cleanup = useQuery({
    queryKey: ['completion-cleanup'],
    queryFn: () => cleanupService.run('scan'),
  });
  const finish = useMutation({
    mutationFn: () =>
      workbench.confirm({
        alias,
        region,
        virtualRuntime,
        browser: p.browserId,
      }),
    onSuccess: onComplete,
  });
  const open = useMutation({
    mutationFn: (app: 'web' | 'code' | 'desktop') =>
      app === 'web'
        ? service.open(virtualRuntime, p.browserId)
        : service.entry(virtualRuntime, p.browserId, app),
  });
  const rows = [
    {
      icon: Network,
      title: '节点与代理',
      value: `${p.nodeName} · 第二步所选出口`,
      status: 'satisfied' as const,
      label: '已检测',
    },
    {
      icon: Box,
      title: '运行环境',
      value: `${p.runtime} · ${virtualRuntime ? 'CodeSeam 专用虚拟环境' : '本机运行环境'}`,
      status: 'satisfied' as const,
      label: '已确认',
    },
    {
      icon: Monitor,
      title: '系统环境',
      value: `时区 ${p.timezone} / 语言 ${p.language}`,
      status: 'unknown' as const,
      label: '已读取',
    },
    {
      icon: SlidersHorizontal,
      title: 'Claude 配置',
      value: cleanup.data
        ? cleanup.data.warnings.length
          ? '部分配置无法读取，原状保留'
          : cleanup.data.items.length
            ? `仍有 ${cleanup.data.items.length} 项旧配置，已保留`
            : '清理结果已记录（含无需清理）'
        : cleanup.isError
          ? '无法读取清理结果，请重试'
          : '正在读取清理结果',
      status: 'unknown' as const,
      label: cleanup.data ? '已记录' : '待读取',
    },
    {
      icon: PanelsTopLeft,
      title: '专用浏览器',
      value: `${p.browserName} ${p.version} · ${p.profileName}`,
      status: browserReady(p) ? ('satisfied' as const) : ('pending' as const),
      label: browserReady(p) ? '已创建' : '待复验',
    },
    {
      icon: Globe,
      title: '浏览器网络',
      value: 'DNS / DoH · IPv4 / IPv6 · WebRTC / QUIC',
      status: 'unknown' as const,
      label: '结果已记录',
    },
  ];
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>确认完成</h1>
        <p>
          核对本次初始化结果。确认后保存正式环境基线，并进入 Claude 使用入口。
        </p>
      </header>
      <div className={styles.columns}>
        <Surface className={styles.summary}>
          <div className={styles.panelTitle}>
            <h2>
              <Globe />
              环境基线摘要
            </h2>
            <span>候选基线 · 待确认</span>
          </div>
          <p className={styles.description}>
            以下信息来自本次初始化检测，请核对关键配置。
          </p>
          <div className={styles.rows}>
            {rows.map(({ icon: Icon, title, value, status, label }) => (
              <div className={styles.row} key={title}>
                <Icon className={styles.icon} size={27} />
                <strong>{title}</strong>
                <span className={styles.value}>{value}</span>
                <StatusLabel status={status} label={label} />
              </div>
            ))}
          </div>
          <p className={styles.note}>
            <Info size={19} />
            无法确认或未覆盖的项目会按实际结果保留，不会自动标记为通过。
          </p>
        </Surface>
        <Surface className={styles.side}>
          <h2>
            <UserRound />
            账号信息（选填）
          </h2>
          <label className={styles.field}>
            账号别名
            <input
              maxLength={80}
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="例如：个人 Claude 账号"
              disabled={finish.isPending}
            />
          </label>
          <label className={styles.field}>
            服务地区
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              disabled={finish.isPending}
            >
              <option value="">未填写</option>
              {['新加坡', '美国', '日本', '英国', '德国', '其他地区'].map(
                (r) => (
                  <option key={r}>{r}</option>
                ),
              )}
            </select>
          </label>
          <p className={styles.hint}>
            仅作本机备注；服务地区为用户声明，不代表资格验证。
          </p>
          <section className={styles.apps}>
            <h2>Claude 应用入口</h2>
            {[
              {
                icon: Globe,
                name: 'Claude Web',
                note: '使用专用浏览器 Profile',
                action: '打开',
              },
              {
                icon: Terminal,
                name: 'Claude Code',
                note: '安装与运行状态将在工作台显示',
                action: '打开入口',
              },
              {
                icon: Monitor,
                name: 'Claude Desktop',
                note: '安装与运行状态将在工作台显示',
                action: '打开入口',
              },
            ].map(({ icon: Icon, name, note, action }) => (
              <div className={styles.app} key={name}>
                <Icon className={styles.icon} size={26} />
                <div>
                  <strong>{name}</strong>
                  <small>{note}</small>
                </div>
                <Button
                  disabled={finish.isPending || open.isPending}
                  onClick={() =>
                    open.mutate(
                      name === 'Claude Web'
                        ? 'web'
                        : name === 'Claude Code'
                          ? 'code'
                          : 'desktop',
                    )
                  }
                >
                  {action}
                </Button>
              </div>
            ))}
          </section>
          <p className={styles.hint}>
            CodeSeam 不读取密码、Cookie 或登录 Token。
          </p>
          {(finish.error || open.error) && (
            <p role="alert" className={styles.error}>
              {(finish.error || open.error)?.message}
            </p>
          )}
          {open.isSuccess && (
            <p role="status" className={styles.hint}>
              已请求通过当前运行环境的专用浏览器打开入口。
            </p>
          )}
        </Surface>
      </div>
      <WizardActions>
        <BackButton disabled={finish.isPending} onClick={onBack} />
        <p className={styles.footerNote}>
          <Info size={19} />
          确认后，候选基线将成为当前正式基线；未覆盖项仍按原状态记录。
        </p>
        <Button
          variant="primary"
          disabled={finish.isPending || open.isPending || !browserReady(p)}
          onClick={() => finish.mutate()}
        >
          {finish.isPending ? '正在复验并保存…' : '确认并完成'}
          <ArrowRight size={23} />
        </Button>
      </WizardActions>
    </div>
  );
}

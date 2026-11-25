import { Select } from '../../components/ui/Select';
import { WizardHeader } from '../../components/layout/WizardHeader';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ArrowRight,
  Monitor,
  UserRound,
  Box,
  Network,
  Puzzle,
  ExternalLink,
  Globe,
  FileCheck,
  Info,
  RefreshCw,
} from 'lucide-react';
import {
  browserReady,
  type BrowserResult,
  type BrowserService,
} from '../../services/browser';
import { Surface } from '../../components/ui/Surface';
import { Button } from '../../components/ui/Button';
import { BackButton } from '../../components/layout/BackButton';
import { WizardActions } from '../../components/layout/WizardActions';
import { CheckRow } from '../../components/business/CheckRow';
import styles from './BrowserPage.module.css';
export function BrowserPage({
  service,
  virtualRuntime,
  onBack,
  onContinue,
}: {
  service: BrowserService;
  virtualRuntime: boolean;
  onBack: () => void;
  onContinue: (result: BrowserResult) => void;
}) {
  const [browser, setBrowser] = useState('');
  const result = useQuery({
    queryKey: ['browser', virtualRuntime, browser],
    queryFn: () => service.prepare(virtualRuntime, browser),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const p = result.data?.profile;
  const operation = useMutation({
    mutationFn: (action: 'open' | 'continue') => {
      if (!p) throw new Error('请先准备专用 Profile');
      return action === 'open'
        ? service.inspect(virtualRuntime, p.browserId).then(() => undefined)
        : service.prepare(virtualRuntime, p.browserId);
    },
    onSuccess: (data) => {
      if (data && browserReady(data.profile)) onContinue(data);
    },
  });
  const busy = result.isFetching || operation.isPending;
  const ready = browserReady(p) && !result.isError;
  const blocked = result.isError || operation.isError || (!!p && !ready);
  const retry = () => {
    operation.reset();
    void result.refetch();
  };
  const observed = p?.verification?.observed;
  const tasks = [
    {
      icon: Monitor,
      label: '检测与升级浏览器',
      value: p
        ? `${p.browserName} ${p.version} · ${p.compatibility.updated ? '已升级并复检' : '版本已校验'}`
        : '校对官方稳定版，版本过旧时自动升级',
      done: p?.compatibility.status === 'satisfied',
    },
    {
      icon: UserRound,
      label: '创建独立 Profile',
      value: p
        ? `Claude 专用 Profile · ${result.data?.reused ? '已恢复' : '已创建'}`
        : '独立保存登录状态',
      done: !!p,
    },
    {
      icon: Box,
      label: '绑定运行环境',
      value: p
        ? `${p.runtime} · ${p.profileId}`
        : virtualRuntime
          ? 'Virtual · 等待 Guest 配置'
          : 'Native · 等待确认',
      done: !!p,
    },
    {
      icon: Network,
      label: '绑定代理出口',
      value:
        p?.proxyStatus === 'satisfied'
          ? `${p.nodeName} · ${p.verification?.exitIp}`
          : '继承第二步所选节点并核对实际出口',
      done: p?.proxyStatus === 'satisfied',
    },
    {
      icon: Puzzle,
      label: '应用浏览器参数',
      value:
        p?.timezoneStatus === 'satisfied'
          ? `时区与出口一致 · ${p.targetTimezone}`
          : '核对浏览器时区与代理出口、语言、能力和权限',
      done:
        p?.parametersStatus === 'satisfied' &&
        p?.timezoneStatus === 'satisfied',
    },
    {
      icon: ExternalLink,
      label: '创建 Claude 快捷方式',
      value: p?.shortcutPath ?? '等待受管启动入口',
      done: p?.shortcutStatus === 'satisfied',
    },
    {
      icon: Globe,
      label: '浏览器网络验证',
      value:
        p?.verificationStatus === 'satisfied'
          ? 'HTTPS 出口一致 · WebRTC 无非代理候选 · QUIC 已禁用'
          : '验证 HTTPS 出口与 WebRTC，限制 DNS / QUIC',
      done: p?.verificationStatus === 'satisfied',
    },
    {
      icon: FileCheck,
      label: '生成候选基线',
      value: p?.baselinePath ?? '等待浏览器级验证结果',
      done: p?.baselineStatus === 'satisfied',
    },
  ];
  const percent = Math.round(
    (tasks.filter((t) => t.done).length / tasks.length) * 100,
  );
  const groups = [
    [
      '基础环境',
      [
        ['独立 Profile', p?.profileName],
        ['Profile 目录', p?.profilePath],
        ['运行环境', p?.runtime],
        ['官方稳定版', p?.compatibility.stableVersion],
      ],
    ],
    [
      '环境继承',
      [
        ['语言', observed?.language ?? p?.language],
        ['代理目标时区', p?.targetTimezone],
        ['浏览器实际时区', observed?.timezone ?? p?.timezone],
        ['User-Agent', observed?.userAgent],
        [
          '验证分辨率',
          observed
            ? `${observed.width} × ${observed.height}（后台探针）`
            : undefined,
        ],
      ],
    ],
    [
      '设备与权限',
      [
        ['权限检测页面', observed?.origin],
        [
          '摄像头 / 麦克风',
          observed
            ? `${observed.permissions.camera} / ${observed.permissions.microphone}`
            : '待观测',
        ],
        ['位置信息', observed?.permissions.geolocation ?? '待观测'],
      ],
    ],
    [
      '图形能力',
      [
        [
          'Canvas / WebGL',
          observed
            ? `${observed.canvas ? '可用' : '不可用'} / ${observed.webgl ? '可用' : '不可用'}`
            : '待观测',
        ],
        [
          'AudioContext',
          observed
            ? observed.audioSampleRate
              ? `${observed.audioSampleRate} Hz`
              : '不可用'
            : '待观测',
        ],
      ],
    ],
    [
      '网络与防护',
      [
        ['当前节点', p?.nodeName],
        ['实测出口', p?.verification?.exitIp],
        ['DNS', p?.verification?.network.dns],
        [
          'WebRTC / QUIC',
          p?.verification
            ? `${p.verification.network.webrtc} / ${p.verification.network.quic}`
            : '待浏览器验证',
        ],
      ],
    ],
  ] as const;
  return (
    <div className={styles.page}>
      <WizardHeader
        title="准备专用浏览器"
        description={
          <>
            {' '}
            自动校对并升级浏览器，准备专用 Profile
            和快捷方式，再验证实际出口。{' '}
          </>
        }
      />
      <div className={styles.columns}>
        <Surface className={styles.tasks}>
          <div className={styles.progress}>
            <progress aria-label="浏览器准备进度" max={100} value={percent} />
            <strong>{percent}%</strong>
          </div>
          <div aria-live="polite">
            {tasks.map(({ icon: Icon, label, value, done }, index) => (
              <CheckRow
                key={label}
                icon={Icon}
                label={label}
                value={value}
                status={
                  done
                    ? 'satisfied'
                    : busy && index === 0
                      ? 'scanning'
                      : 'pending'
                }
                statusLabel={
                  done
                    ? '完成'
                    : busy && index === 0
                      ? virtualRuntime
                        ? '启动 / 检测中'
                        : '检测中'
                      : index >= 6
                        ? '待验证'
                        : '待完成'
                }
              />
            ))}
          </div>
          {!busy &&
            (result.isError || operation.isError || p?.verificationError) && (
              <p role="alert" className={styles.error}>
                {result.error?.message ??
                  operation.error?.message ??
                  p?.verificationError}
              </p>
            )}
          {(p || busy) && (
            <p className={styles.note}>
              {busy
                ? '正在自动关闭占用专用 Profile 的浏览器并继续初始化，登录数据会保留。校对版本、升级及出口验证可能需数分钟。'
                : ready
                  ? '浏览器版本与网络验证已通过。可打开验证页面自行查看 IP 质量；下一步会复验并显示确认摘要；正式基线将在最终确认后保存。'
                  : '已有 Profile 和登录状态已保留。请处理上方提示后点击重试，继续初始化。'}
            </p>
          )}
        </Surface>
        <Surface className={styles.parameters}>
          <div className={styles.panelTitle}>
            <h2>
              <Monitor size={26} />
              浏览器参数
            </h2>
            <Button variant="quiet" disabled={busy} onClick={retry}>
              <RefreshCw size={17} />
              {busy ? '准备中…' : blocked ? '重试' : '重新检测'}
            </Button>
          </div>
          <label className={styles.browser}>
            浏览器
            <Select
              aria-label="选择浏览器"
              value={p?.browserId ?? browser}
              disabled={busy || !p}
              onChange={(e) => setBrowser(e.target.value)}
            >
              {!p && <option value="">自动检测 Chrome / Edge</option>}
              {result.data?.available.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} {b.version}
                </option>
              ))}
            </Select>
          </label>
          {groups.map(([name, rows]) => (
            <section className={styles.group} key={name}>
              <h3>{name}</h3>
              <dl>
                {rows.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd title={value ?? ''}>{value ?? '待检测'}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <div className={styles.verify}>
            <Button
              disabled={busy || !ready}
              onClick={() => operation.mutate('open')}
            >
              <ExternalLink size={21} />
              打开验证
            </Button>
            <p className={styles.note}>
              使用专用浏览器访问 ip.net.coffee/claude/，请自行查看 IP 质量。
            </p>
          </div>
        </Surface>
      </div>
      <WizardActions>
        <BackButton disabled={busy} onClick={onBack} />
        <p className={styles.privacy}>
          <Info size={19} />
          专用 Profile 独立保存登录状态，不读取或修改日常浏览器数据。
        </p>
        <Button
          variant="primary"
          disabled={busy || (!ready && !blocked)}
          onClick={() => (blocked ? retry() : operation.mutate('continue'))}
        >
          {busy ? '处理中…' : blocked ? '重试' : '下一步'}
          {blocked ? <RefreshCw size={23} /> : <ArrowRight size={23} />}
        </Button>
      </WizardActions>
    </div>
  );
}

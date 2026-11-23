import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Monitor,
  Cpu,
  Check,
  RefreshCw,
  Info,
  ShieldCheck,
  LoaderCircle,
  Clock,
  Languages,
  Network,
  Globe,
  HardDrive,
  Grid2X2,
} from 'lucide-react';
import type { RuntimeService } from '../../services/runtime';
import {
  virtualOperation,
  type VMConfig,
  type VMResources,
  type GuestStatus,
} from '../../services/runtime/virtual';
import { Surface } from '../../components/ui/Surface';
import { Button } from '../../components/ui/Button';
import { BackButton } from '../../components/ui/BackButton';
import { WizardActions } from '../../components/layout/WizardActions';
import styles from './VirtualPage.module.css';
const demo = new URLSearchParams(location.search).get('virtual');
const preview = import.meta.env.DEV && !('__TAURI_INTERNALS__' in window);
const tasks = [
  ['安装 Windows 并首次启动', Grid2X2],
  ['设置系统时区', Clock],
  ['语言与区域格式', Languages],
  ['检查时间同步', RefreshCw],
  ['配置受管代理', Network],
  ['验证 DNS 实际路径', Globe],
  ['验证 IPv4 / IPv6 / UDP', Monitor],
  ['生成候选环境基线', ShieldCheck],
] as const;
export function VirtualPage({
  onBack,
  onContinue = () => {},
}: {
  service?: RuntimeService;
  onBack: () => void;
  onContinue?: () => void;
}) {
  const [config, setConfig] = useState<VMConfig>({
    name: 'CodeSeam-Claude-01',
    iso: 'https://archive.org/download/tiny-10-23-h2/tiny10%20x64%2023h2.iso',
    cpu: 2,
    memory: 4,
    disk: 64,
    network: '',
  });
  const [phase, setPhase] = useState(demo === 'guest' ? 'guest' : 'entry');
  const [initializationError, setInitializationError] = useState('');
  const [installStep, setInstallStep] = useState('');
  const [later, setLater] = useState(false);
  const [demoReboot, setDemoReboot] = useState(false);
  const resource = useQuery({
    queryKey: ['virtual-resources'],
    retry: false,
    queryFn: async () => {
      const r: VMResources = preview
        ? {
            ready: demo !== 'prepare' && demo !== 'reboot',
            reboot: demo === 'reboot',
            enabled: demo === 'reboot',
            hardware: true,
            windows: true,
            cpu: 8,
            memory: 24,
            disk: 500,
            switches: ['CodeSeam Internal（演示）'],
          }
        : await virtualOperation('read');
      return r;
    },
  });
  const r =
    demoReboot && resource.data
      ? { ...resource.data, reboot: true, enabled: true }
      : resource.data;
  const initialized = useRef(false);
  useEffect(() => {
    if (!r || initialized.current) return;
    initialized.current = true;
    setConfig(
      (c) =>
        r.checkpoint?.config ?? {
          ...c,
          cpu: Math.max(1, Math.min(2, r.cpu - 1)),
          memory: Math.max(4, Math.min(6, r.memory - 2)),
          network: r.switches[0] ?? '',
        },
    );
    if (r.checkpoint?.phase === 'guest') setPhase('guest');
  }, [r]);
  const guest = useQuery({
    queryKey: ['virtual-guest'],
    enabled: phase === 'guest',
    refetchInterval: preview ? false : 5000,
    queryFn: async (): Promise<GuestStatus> =>
      preview
        ? {
            name: config.name,
            state: 'Running',
            ready: false,
            detail: '开发演示：等待 Windows 首次安装及 Guest 接入。',
          }
        : virtualOperation('status'),
  });
  const initialization = useRef(false);
  useEffect(() => {
    if (phase !== 'guest' || preview || initialization.current) return;
    initialization.current = true;
    void virtualOperation('initialize')
      .then(() => guest.refetch())
      .catch((error: unknown) => {
        setInitializationError(String(error));
        void guest.refetch();
      });
  }, [phase, guest.refetch]);
  const image = useQuery({
    queryKey: ['virtual-image-progress'],
    enabled: !preview && installStep === 'download',
    refetchInterval: 500,
    queryFn: () =>
      virtualOperation<{ received: number; total?: number }>('image_status'),
  });
  const action = useMutation({
    onError: () => setInstallStep('failed'),
    mutationFn: async (kind: string) => {
      if (kind === 'retry') {
        setInitializationError('');
        await virtualOperation('initialize');
        await guest.refetch();
        return;
      }
      if (kind === 'continue') {
        if (!preview) {
          const result = await virtualOperation<{
            ready: boolean;
            consoleOpened: boolean;
          }>('ensure_ready', { openConsole: true });
          if (!result.ready || !result.consoleOpened)
            throw new Error('目标虚拟机桌面或连接窗口尚未就绪，请重试。');
        }
        onContinue();
        return;
      }
      if (preview) {
        if (kind === 'create') setPhase('guest');
        if (kind === 'enable') setDemoReboot(true);
        if (kind === 'restart') setLater(true);
        return;
      }
      if (kind === 'create') {
        setPhase('installing');
        setInstallStep('download');
        const media = await virtualOperation<{ path: string }>(
          'prepare_image',
          config,
        );
        setInstallStep('create');
        await virtualOperation(kind, { ...config, iso: media.path });
        setInstallStep('');
      } else {
        await virtualOperation(kind, config);
      }
      if (kind === 'create') setPhase('guest');
      else await resource.refetch();
    },
  });
  const errors = {
    name: /^[\p{L}\p{N}_-]{1,64}$/u.test(config.name)
      ? ''
      : '请输入 1–64 位字母、数字、下划线或短横线',
    iso: /^(?:https?:\/\/[^\s?#]+\.iso(?:[?#].*)?|[^\r\n]+\.iso)$/i.test(
      config.iso.trim(),
    )
      ? ''
      : '请填写合法授权 Windows 10 x64 ISO 的本地路径或 HTTP(S) 地址',
    cpu:
      r &&
      Number.isInteger(config.cpu) &&
      config.cpu >= 1 &&
      config.cpu <= r.cpu - 1
        ? ''
        : '需为宿主机保留一个逻辑处理器',
    memory:
      r &&
      Number.isInteger(config.memory) &&
      config.memory >= 4 &&
      config.memory <= r.memory - 2
        ? ''
        : 'Guest 至少 4 GB，宿主机保留 2 GB',
    disk:
      r &&
      Number.isInteger(config.disk) &&
      config.disk >= 40 &&
      config.disk <= r.disk - 10
        ? ''
        : '磁盘至少 40 GB，宿主机保留 10 GB',
    network: config.network ? '' : '请先在 Hyper-V 配置内部虚拟交换机',
  };
  const busy = action.isPending || resource.isFetching;
  const preparing = phase !== 'guest' && phase !== 'installing' && !r?.ready;
  const guestFailed = !!(
    initializationError ||
    guest.data?.error ||
    guest.isError
  );
  const statusError =
    initializationError ||
    guest.data?.error ||
    guest.error?.message ||
    action.error?.message;
  const statusText =
    statusError ||
    (phase === 'installing'
      ? installStep === 'download'
        ? `正在准备安装镜像 · ${((image.data?.received ?? 0) / 1048576).toFixed(1)} MB${image.data?.total ? ` / ${(image.data.total / 1048576).toFixed(1)} MB` : ''}`
        : '正在创建并启动虚拟机…'
      : guest.data?.detail || '正在连接 Guest…');
  const title = preparing
    ? '准备虚拟化环境'
    : phase === 'guest' || phase === 'installing'
      ? '初始化虚拟机环境'
      : '创建独立运行环境';
  function field(
    key: keyof VMConfig,
    label: string,
    Icon: typeof Cpu,
    numeric = false,
  ) {
    return (
      <label className={styles.field}>
        <Icon />
        <strong>{label}</strong>
        <div>
          <input
            aria-label={label}
            type={numeric ? 'number' : 'text'}
            value={config[key]}
            disabled={busy}
            onChange={(e) =>
              setConfig({
                ...config,
                [key]: numeric ? Number(e.target.value) : e.target.value,
              })
            }
          />
          {errors[key] && <small>{errors[key]}</small>}
        </div>
      </label>
    );
  }
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>{title}</h1>
        <p>
          {preparing
            ? 'CodeSeam 将自动准备创建独立 Windows 环境所需的系统组件。'
            : phase === 'guest'
              ? '在 Guest 内准备系统与受管网络，确保每项检查具有独立证据。'
              : '为 Claude 准备单独的 Windows 虚拟机，确认资源配置后再创建。'}
        </p>
      </header>
      {phase !== 'guest' &&
        phase !== 'installing' &&
        (resource.error || action.error) && (
          <p role="alert" className={styles.error}>
            {resource.error
              ? '无法读取虚拟化环境，请重新检测。'
              : action.error?.message}
          </p>
        )}
      {preparing ? (
        <Surface className={styles.prepare}>
          <div className={styles.summary}>
            {[
              'CPU 虚拟化 / SLAT',
              'Windows 版本',
              'BIOS / UEFI 虚拟化',
              'Hyper-V 功能',
            ].map((label, i) => (
              <span key={label}>
                {r && (i === 1 ? r.windows : i < 3 ? r.hardware : r.ready) ? (
                  <Check />
                ) : (
                  <Info />
                )}
                {label}
                {i === 3 && r?.reboot && <small>已配置 · 待重启生效</small>}
              </span>
            ))}
          </div>
          <div className={styles.hero}>
            {r?.reboot ? <RefreshCw /> : <Monitor />}
            <div>
              <h2>
                {resource.isPending
                  ? '正在读取系统组件状态…'
                  : resource.isError
                    ? '虚拟化环境检测失败'
                    : r?.reboot
                      ? 'Hyper-V 已启用，需要重启系统'
                      : '当前需要准备 Windows 虚拟化组件'}
              </h2>
              <p>
                {resource.isError
                  ? '请重新检测。'
                  : r?.reboot
                    ? '请重启 Windows 使配置生效。'
                    : '启用 Hyper-V 平台和管理工具后，复验服务与管理接口。'}
              </p>
            </div>
          </div>
          {r?.reboot ? (
            <>
              <p className={styles.notice}>
                重启后重新打开 CodeSeam，复验通过后进入配置页；创建仍需确认。
              </p>
              <div className={styles.actions}>
                <Button onClick={() => setLater(true)}>稍后重启</Button>
                <Button
                  variant="primary"
                  onClick={() => action.mutate('restart')}
                  disabled={busy}
                >
                  立即重启
                </Button>
              </div>
              {later && (
                <p role="status">进度已保留，请保存工作后重启 Windows。</p>
              )}
            </>
          ) : (
            <>
              <div className={styles.components}>
                <strong>将启用</strong>
                <div>
                  <p>
                    <Check />
                    Hyper-V 平台
                  </p>
                  <p>
                    <Check />
                    Hyper-V 管理工具
                  </p>
                </div>
              </div>
              <div className={styles.actions}>
                <Button
                  variant="primary"
                  disabled={busy || !r?.hardware || !r?.windows}
                  onClick={() => action.mutate('enable')}
                >
                  <ShieldCheck />
                  {action.isPending ? '正在启用…' : '启用 Hyper-V'}
                </Button>
                <Button disabled={busy} onClick={() => void resource.refetch()}>
                  <RefreshCw />
                  重新检测
                </Button>
              </div>
            </>
          )}
        </Surface>
      ) : phase === 'guest' || phase === 'installing' ? (
        <div className={styles.guestColumns}>
          <Surface className={styles.panel}>
            <p
              className={`${styles.liveStatus} ${statusError ? styles.failed : ''}`}
              role={statusError ? 'alert' : 'status'}
              title={statusText}
            >
              {statusText}
            </p>
            <div className={styles.progress}>
              <progress
                aria-label="Guest 初始化进度"
                max={phase === 'guest' ? 8 : image.data?.total || undefined}
                value={
                  phase === 'guest'
                    ? ((guest.data?.progress ?? 0) / 100) * 8
                    : phase === 'installing' &&
                        installStep === 'download' &&
                        image.data?.total
                      ? image.data?.received
                      : undefined
                }
              />
              <strong>
                {phase === 'installing'
                  ? action.isError
                    ? '初始化失败，可重试'
                    : installStep === 'download'
                      ? '准备安装镜像…'
                      : '正在创建虚拟机…'
                  : `${guest.data?.progress ?? 0}%`}
              </strong>
            </div>
            {tasks.map(([label, Icon], index) => (
              <div className={styles.task} key={label}>
                <Icon />
                <strong>{label}</strong>
                <span>
                  {guest.data?.tasks?.[index]?.detail ??
                    (index === 0
                      ? phase === 'installing'
                        ? '等待镜像准备与虚拟机创建'
                        : (guest.data?.detail ?? '正在连接自动初始化任务…')
                      : '等待前序任务完成')}
                </span>
                <span>
                  {guest.data?.tasks?.[index]?.status === 'satisfied' ? (
                    <Check />
                  ) : guest.data?.tasks?.[index]?.status === 'running' ||
                    (index === 0 &&
                      phase === 'installing' &&
                      !action.isError) ? (
                    <LoaderCircle className={styles.spin} />
                  ) : guest.data?.tasks?.[index]?.status === 'failed' ? (
                    '失败'
                  ) : (
                    '待检测'
                  )}
                </span>
              </div>
            ))}
          </Surface>
          <Surface className={styles.panel}>
            <h2>
              <Monitor />
              目标环境
            </h2>
            {[
              ['运行方式', 'Virtual · Hyper-V'],
              ['虚拟机', guest.data?.name || config.name],
              [
                'VM 状态',
                phase === 'installing'
                  ? '准备中'
                  : (guest.data?.state ?? '读取中'),
              ],
              ['已选节点', guest.data?.nodeName ?? '沿用第二步已选节点'],
              ['Guest 时区', guest.data?.timezone || '待设置'],
              ['Guest 语言', guest.data?.language || '待设置'],
              [
                'Guest DNS',
                guest.data?.tasks?.[5]?.status === 'satisfied'
                  ? '受管加密 DNS · 已验证'
                  : '实际路径待验证',
              ],
              [
                'Guest IPv6 / UDP',
                guest.data?.tasks?.[6]?.status === 'satisfied'
                  ? 'IPv6 关闭 / UDP 阻断 · 已验证'
                  : '实际路径待验证',
              ],
            ].map(([k, v]) => (
              <div className={styles.kv} key={k}>
                <span>{k}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </Surface>
        </div>
      ) : (
        <div className={styles.columns}>
          <Surface className={styles.panel}>
            <h2>
              <Monitor />
              虚拟机配置
            </h2>
            {field('name', '虚拟机名称', Monitor)}
            <label className={styles.field}>
              <Grid2X2 />
              <strong>操作系统</strong>
              <input
                aria-label="操作系统"
                value="Windows 10 x64 · Generation 2"
                readOnly
              />
            </label>
            {field('iso', '安装镜像', HardDrive)}
            {field('cpu', '处理器（vCPU）', Cpu, true)}
            {field('memory', '运行内存（GB）', HardDrive, true)}
            {field('disk', '虚拟磁盘（GB）', HardDrive, true)}
            <label className={styles.field}>
              <Network />
              <strong>虚拟网络</strong>
              <div>
                <select
                  aria-label="虚拟网络"
                  value={config.network}
                  disabled={busy}
                  onChange={(e) =>
                    setConfig({ ...config, network: e.target.value })
                  }
                >
                  <option value="">请选择内部虚拟交换机</option>
                  {r?.switches.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
                {errors.network && <small>{errors.network}</small>}
              </div>
            </label>
            <p className={styles.security}>
              <ShieldCheck />
              Secure Boot 已启用 · 虚拟 TPM 待镜像兼容验证
            </p>
          </Surface>
          <Surface className={styles.panel}>
            <h2>
              <Cpu />
              资源与创建预览
            </h2>
            <div className={styles.resources}>
              <h3>宿主机可用资源{preview ? '（开发演示）' : ''}</h3>
              {[
                ['CPU', config.cpu, r?.cpu, '逻辑处理器'],
                ['内存', config.memory, r?.memory, 'GB'],
                ['虚拟磁盘', config.disk, r?.disk, 'GB'],
              ].map(([label, value, total, unit]) => (
                <div key={String(label)}>
                  <div className={styles.kv}>
                    <strong>{label}</strong>
                    <span>
                      {value} / {total ?? '—'} {unit}
                    </span>
                  </div>
                  <progress max={Number(total) || 1} value={Number(value)} />
                </div>
              ))}
            </div>
            <p>
              <Check />
              使用第 2 代 VM、Secure Boot 与动态扩展 VHDX
            </p>
            <p>
              <Check />
              使用第二步已选节点作为受管出口基准
            </p>
            <p className={styles.note}>
              <Info />
              创建后需确认 VM 可启动，才能继续初始化 Guest。
            </p>
            <p className={styles.note}>
              支持本地 ISO 或 HTTP(S)
              下载地址，远程镜像将自动下载并缓存。请使用合法授权的 Windows 10
              x64 安装介质。镜像兼容性尚待验证。
            </p>
          </Surface>
        </div>
      )}
      <WizardActions>
        <BackButton
          disabled={busy || (phase === 'guest' && !guestFailed)}
          onClick={onBack}
        />
        <p className={styles.footer}>
          <Info />
          {phase === 'guest'
            ? 'Guest 内的 DNS、IPv6 与 UDP 需独立复验，不能直接沿用宿主机结果。'
            : preparing
              ? '启用组件需要 Windows 管理员权限；重启前请保存工作。'
              : '创建后将进入 Guest 初始化。'}
        </p>
        <Button
          variant="primary"
          disabled={
            preparing ||
            (phase === 'guest' &&
              !guestFailed &&
              (!guest.data?.ready || guest.data.desktopSetupVersion !== 3)) ||
            busy ||
            Object.values(errors).some(Boolean)
          }
          onClick={() =>
            action.mutate(
              phase === 'guest'
                ? guestFailed
                  ? 'retry'
                  : 'continue'
                : 'create',
            )
          }
        >
          {(guestFailed && phase === 'guest') ||
          (action.isError && phase === 'installing')
            ? '重试'
            : action.isPending
              ? phase === 'guest'
                ? action.variables === 'retry'
                  ? '正在重试初始化…'
                  : '正在确认 Guest 与虚拟机窗口…'
                : '正在初始化…'
              : phase === 'guest' || preparing
                ? '下一步 →'
                : '创建'}
        </Button>
      </WizardActions>
    </div>
  );
}

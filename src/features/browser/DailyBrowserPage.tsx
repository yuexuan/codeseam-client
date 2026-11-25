import { PanelTitle } from '../../components/layout/PanelTitle';
import { TabList } from '../../components/ui/TabList';
import { RuntimeIdentity } from '../../components/business/RuntimeIdentity';
import { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  CircleDot,
  ExternalLink,
  Fingerprint,
  MonitorCheck,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { WorkspaceHeader } from '../../components/layout/WorkspaceHeader';
import { WorkspacePanel } from '../../components/layout/WorkspacePanel';
import { Button } from '../../components/ui/Button';
import { StatusLabel } from '../../components/business/StatusLabel';
import { DetailDialog } from '../../components/ui/DetailDialog';
import { formatTime, type WorkbenchRecord } from '../../services/workbench';
import type {
  DailyBrowserAction,
  DailyBrowserDetails,
  DailyBrowserService,
} from '../../services/browser/daily';
import chrome from '../../assets/google-chrome.png';
import edge from '../../assets/microsoft-edge.png';
import styles from './DailyBrowserPage.module.css';

const tabs = [
  '基础环境',
  'Navigator',
  '时区与显示',
  '设备与图形',
  '网络与隐私',
];
type Parameter = [string, string | null | undefined, string];

export function DailyBrowserPage({
  record,
  service,
  data,
  checking,
  checkError,
  refresh: read,
}: {
  record: WorkbenchRecord;
  service: DailyBrowserService;
  data?: DailyBrowserDetails;
  checking: boolean;
  checkError?: string;
  refresh: () => Promise<WorkbenchRecord>;
}) {
  const [tab, setTab] = useState(0);
  const [dialog, setDialog] = useState<
    'recreate' | 'version' | 'profile' | null
  >(null);
  const [notice, setNotice] = useState('');
  const tabsId = useId();
  const operation = useMutation({
    mutationFn: (action: DailyBrowserAction) => service.run(action),
    onSuccess: async (_, action) => {
      setDialog(null);
      setNotice(
        action === 'open'
          ? '已通过受管启动器打开 Claude'
          : action === 'verify'
            ? '浏览器验证完成，检测结果已更新'
            : '受管配置已重新创建，原 Profile 和登录状态已保留',
      );
      await read().catch(() => {});
    },
    onError: () => {
      void read().catch(() => {});
    },
  });
  const p = data?.profile;
  const observed = p?.verification?.observed;
  const busy = checking || operation.isPending;
  const ready =
    !!p && !!data?.online && data.profileExists && !!data.installedVersion;
  const canOpen =
    ready &&
    data.baselineMatches &&
    data.shortcutValid &&
    p?.verificationStatus === 'satisfied' &&
    p?.timezoneStatus === 'satisfied' &&
    !p?.verificationError;
  const verified =
    ready &&
    data.baselineMatches &&
    data.checks.length === 6 &&
    data.checks.every((item) => item.status === 'satisfied');
  const at = p?.verification?.measuredAt;
  const error = checkError ?? operation.error?.message ?? data?.error;
  const run = (action: DailyBrowserAction) => {
    setNotice('');
    operation.mutate(action);
  };
  const refresh = () => {
    setNotice('');
    operation.reset();
    void read().catch(() => {});
  };
  const runtime = record.virtualRuntime ? 'Virtual' : 'Native';
  const baseline = record.baseline.profile;
  const browserName = p?.browserName ?? '专用浏览器待检测';
  const major = data?.installedVersion?.split('.')[0];
  const supported = (value: boolean | undefined) =>
    value === undefined ? undefined : value ? '支持' : '不支持';
  const timezone = observed?.timezone
    ? `${observed.timezone}${observed.utcOffset ? ` · ${observed.utcOffset}` : ''}`
    : undefined;
  const launchDay =
    data?.lastLaunched &&
    new Date(data.lastLaunched).toLocaleDateString('zh-CN') ===
      new Date().toLocaleDateString('zh-CN')
      ? '今日'
      : data?.lastLaunched
        ? new Date(data.lastLaunched).toLocaleDateString('zh-CN', {
            month: 'numeric',
            day: 'numeric',
          })
        : '';
  const parameters: Parameter[][] = [
    [
      ['浏览器厂商', p?.browserName, '实际值'],
      ['浏览器内核', major ? `Chromium ${major}` : undefined, '实际值'],
      [
        '运行平台',
        observed?.platform ??
          (observed?.userAgent.includes('Windows') ? 'Win32' : undefined),
        '实际值',
      ],
      ['Profile ID', p?.profileId, '受管配置'],
      ['浏览器语言', observed?.language, 'Runtime 继承'],
      ['实际时区', timezone, 'Runtime 继承'],
      [
        '屏幕分辨率',
        observed ? `${observed.width} × ${observed.height}` : undefined,
        '实际值',
      ],
      ['启动入口', ready ? 'CodeSeam 受管启动器' : undefined, '受管配置'],
    ],
    [
      ['User-Agent', observed?.userAgent, '实际值'],
      [
        '运行平台',
        observed?.platform ??
          (observed?.userAgent.includes('Windows') ? 'Win32' : undefined),
        '实际值',
      ],
      ['首选语言', observed?.language, 'Runtime 继承'],
      ['语言列表', observed?.languages?.join('、'), 'Runtime 继承'],
      ['CPU 并发数', observed?.hardwareConcurrency?.toString(), '实际值'],
      [
        '设备内存',
        observed?.deviceMemory ? `${observed.deviceMemory} GB` : undefined,
        '实际值',
      ],
      ['浏览器版本', data?.installedVersion, '实际值'],
      ['环境归属', p?.runtime, 'Runtime 继承'],
    ],
    [
      ['实际时区', observed?.timezone, 'Runtime 继承'],
      ['目标时区', p?.targetTimezone, '受管配置'],
      ['UTC Offset', observed?.utcOffset, '实际值'],
      [
        '时区一致性',
        observed
          ? observed.timezone === p?.targetTimezone
            ? '与目标时区一致'
            : '与目标时区不一致'
          : undefined,
        '实际值',
      ],
      [
        '屏幕分辨率',
        observed ? `${observed.width} × ${observed.height}` : undefined,
        '实际值',
      ],
      ['设备像素比', observed?.devicePixelRatio?.toString(), '实际值'],
      ['系统语言', p?.language, 'Runtime 继承'],
      ['显示数据来源', observed ? '最近一次浏览器探针' : undefined, '实际值'],
    ],
    [
      ['Canvas', supported(observed?.canvas), '实际值'],
      ['WebGL', supported(observed?.webgl), '实际值'],
      ['WebGL 渲染器', observed?.webglRenderer, '实际值'],
      ['WebGPU', supported(observed?.webgpu), '实际值'],
      ['CPU 并发数', observed?.hardwareConcurrency?.toString(), '实际值'],
      [
        '设备内存',
        observed?.deviceMemory ? `${observed.deviceMemory} GB` : undefined,
        '实际值',
      ],
      [
        '音频采样率',
        observed?.audioSampleRate
          ? `${observed.audioSampleRate} Hz`
          : undefined,
        '实际值',
      ],
      ['字体能力', undefined, '实际值'],
    ],
    [
      ['出口节点', p?.nodeName, 'CodeSeam 管理'],
      ['DNS / DoH', p?.verification?.network.dns, 'CodeSeam 管理'],
      ['WebRTC', p?.verification?.network.webrtc, '实际值'],
      ['QUIC / HTTP/3', p?.verification?.network.quic, 'CodeSeam 管理'],
      ...(
        ['camera', 'microphone', 'geolocation', 'notifications'] as const
      ).map((key, index): Parameter => [
        ['摄像头权限', '麦克风权限', '位置权限', '通知权限'][index],
        (
          {
            prompt: '询问',
            granted: '允许',
            denied: '拒绝',
            unsupported: '不支持',
          } as Record<string, string>
        )[observed?.permissions[key] ?? ''],
        '用户权限',
      ]),
    ],
  ];
  return (
    <div className={styles.page}>
      <WorkspaceHeader title="专用浏览器">
        <RuntimeIdentity
          runtime={runtime}
          node={p?.nodeName ?? baseline.nodeName}
          exitIp={
            (data?.baselineMatches ? p?.verification?.exitIp : undefined) ??
            '出口待验证'
          }
        />
      </WorkspaceHeader>
      <WorkspacePanel className={styles.summary}>
        <MonitorCheck className={styles.summaryIcon} />
        <h2>
          {operation.isPending || (checking && !data)
            ? operation.isPending
              ? '正在处理浏览器操作'
              : '正在检测专用浏览器'
            : ready
              ? '专用浏览器已就绪'
              : '专用浏览器待就绪'}
        </h2>
        <span className={styles.browserSummary}>
          {p && major
            ? `${p?.browserId === 'chrome' ? 'Chrome' : 'Edge'} ${major} · 独立 Profile`
            : '独立 Profile · 待读取'}
        </span>
        <div className={styles.networkSummary}>
          <ShieldCheck />
          <h2>{verified ? '浏览器网络已验证' : '浏览器网络待验证'}</h2>
          <span>{at ? formatTime(at) : '尚未验证'}</span>
        </div>
        <Button
          variant="icon"
          className={styles.refresh}
          disabled={busy}
          onClick={refresh}
          aria-label="重新检测专用浏览器"
          title="重新检测专用浏览器"
        >
          <RefreshCw />
        </Button>
      </WorkspacePanel>
      {(error || notice || data?.notice) && (
        <p
          className={error ? styles.error : styles.notice}
          role={error ? 'alert' : 'status'}
        >
          {error || notice || data?.notice}
        </p>
      )}
      <div className={styles.columns}>
        <WorkspacePanel
          className={styles.profile}
          role="region"
          aria-label="专用 Profile"
        >
          <header className={styles.panelHeading}>
            <PanelTitle>
              <CircleDot />
              专用 Profile
            </PanelTitle>
            <Button
              disabled={busy}
              onClick={() => {
                operation.reset();
                setDialog('recreate');
              }}
            >
              <RefreshCw size={19} />
              重新创建
            </Button>
          </header>
          <div className={styles.profileBody}>
            <div className={styles.browser}>
              {p && (
                <img
                  src={p.browserId === 'chrome' ? chrome : edge}
                  alt={p.browserName}
                />
              )}
              <div>
                <button
                  className={styles.browserTitle}
                  onClick={() => setDialog('profile')}
                  disabled={!p}
                >
                  {browserName}
                </button>
                <p>
                  {major
                    ? `Chromium ${major} · Claude 专用环境`
                    : '绑定当前 Runtime 的独立浏览器环境'}
                </p>
              </div>
              <StatusLabel
                status={
                  checking && !data
                    ? 'scanning'
                    : ready
                      ? 'satisfied'
                      : 'unknown'
                }
                label={ready ? '已就绪' : '待检测'}
              />
            </div>
            <dl className={styles.profileRows}>
              <div>
                <dt>Profile 名称</dt>
                <dd>{p?.profileName ?? '待读取'}</dd>
              </div>
              <div>
                <dt>当前版本</dt>
                <dd>
                  {data?.installedVersion ?? '待读取'}
                  <button
                    disabled={busy || !p}
                    onClick={() => {
                      refresh();
                      setDialog('version');
                    }}
                  >
                    检查更新 <ExternalLink size={13} />
                  </button>
                </dd>
              </div>
              <div>
                <dt>所属 Runtime</dt>
                <dd>
                  {runtime} · {record.virtualRuntime ? '虚拟机' : '本机'}
                </dd>
              </div>
              <div>
                <dt>Claude 快捷方式</dt>
                <dd>
                  <button
                    className={styles.shortcut}
                    disabled={busy || !p}
                    onClick={() => setDialog('recreate')}
                    title="查看快捷方式修复"
                  >
                    <StatusLabel
                      status={data?.shortcutValid ? 'satisfied' : 'unknown'}
                      label={data?.shortcutValid ? '已创建' : '待修复'}
                    />
                  </button>{' '}
                  · 受管启动
                </dd>
              </div>
              <div>
                <dt>最后启动</dt>
                <dd>
                  {data?.lastLaunched
                    ? `${launchDay} ${formatTime(data.lastLaunched)}`
                    : '尚无启动记录'}
                </dd>
              </div>
            </dl>
            <div className={styles.profileActions}>
              <Button
                variant="primary"
                disabled={busy || !canOpen}
                onClick={() => run('open')}
              >
                <ExternalLink size={20} />
                打开 Claude
              </Button>
              <Button disabled={busy || !ready} onClick={() => run('verify')}>
                <ShieldCheck size={21} />
                {operation.isPending && operation.variables === 'verify'
                  ? '正在验证…'
                  : '打开验证'}
              </Button>
            </div>
          </div>
        </WorkspacePanel>
        <WorkspacePanel
          className={styles.validation}
          role="region"
          aria-label="浏览器网络验证"
        >
          <header className={styles.panelHeading}>
            <PanelTitle>
              <ShieldCheck />
              浏览器网络验证
            </PanelTitle>
            <button
              className={styles.recheck}
              disabled={busy}
              onClick={refresh}
              aria-label="重新检测浏览器网络"
            >
              <RefreshCw />
              <span>重新检测</span>
            </button>
          </header>
          <div className={styles.networkChecks}>
            {(data?.checks.length
              ? data.checks
              : [
                  '代理出口',
                  'DNS / DoH',
                  'WebRTC',
                  'IPv4 / IPv6',
                  'QUIC / HTTP/3',
                  '代理绕过',
                ].map((title) => ({
                  id: title,
                  title,
                  value: busy ? '正在读取…' : '待验证',
                  status: 'unknown' as const,
                }))
            ).map((item) => (
              <div key={item.id}>
                <StatusLabel
                  status={checking && !data ? 'scanning' : item.status}
                  label={item.title}
                />
                <span>{item.value}</span>
              </div>
            ))}
            <p>
              最近浏览器级验证：{at ? formatTime(at) : '尚未验证'}
              <span>·</span>
              {verified ? '与当前环境基线一致' : '未确认项目需浏览器级复验'}
            </p>
          </div>
        </WorkspacePanel>
      </div>
      <WorkspacePanel
        className={styles.parameters}
        role="region"
        aria-label="浏览器参数"
      >
        <header className={styles.parameterHeading}>
          <PanelTitle>
            <Fingerprint />
            浏览器参数
          </PanelTitle>
          <TabList
            id={tabsId}
            label="浏览器参数分类"
            items={tabs.map((label, index) => ({
              value: String(index),
              label,
            }))}
            value={String(tab)}
            onChange={(value) => setTab(Number(value))}
          />
        </header>
        <div
          role="tabpanel"
          id={`${tabsId}-panel`}
          aria-labelledby={`${tabsId}-tab-${tab}`}
          className={styles.parameterContent}
          tabIndex={0}
        >
          {[parameters[tab].slice(0, 4), parameters[tab].slice(4)].map(
            (column, index) => (
              <dl key={index}>
                {column.map(([title, value, source]) => (
                  <div key={title}>
                    <dt>{title}</dt>
                    <dd title={value ?? '待验证'}>{value ?? '待验证'}</dd>
                    <span>{source}</span>
                  </div>
                ))}
              </dl>
            ),
          )}
        </div>
      </WorkspacePanel>
      {dialog && (
        <DetailDialog
          title={
            dialog === 'recreate'
              ? '重新创建受管浏览器配置'
              : dialog === 'version'
                ? '浏览器版本与更新'
                : '专用 Profile 信息'
          }
          onClose={() => setDialog(null)}
          closeLabel="返回专用浏览器"
          locked={operation.isPending}
        >
          {dialog === 'recreate' ? (
            <>
              <p>
                将重新检测浏览器、绑定当前 Runtime 和代理、修复 CodeSeam
                快捷方式并验证。为应用配置，正在运行的专用浏览器窗口会关闭，请先保存工作。
              </p>
              <p>
                保留原 Profile、Cookie
                和登录状态；不会清除浏览数据或更改普通浏览器。
              </p>
              <Button disabled={busy} onClick={() => run('recreate')}>
                {operation.isPending ? '正在重新创建…' : '确认重新创建'}
              </Button>
            </>
          ) : dialog === 'version' ? (
            <>
              <p>当前安装版本：{data?.installedVersion ?? '正在检测…'}</p>
              <p>
                最近校对的官方稳定版：
                {p?.compatibility.stableVersion ?? '待读取'}
              </p>
              <p>
                重新创建时会检查官方稳定版本，按需更新浏览器并复验。Profile
                和登录状态保留。
              </p>
              <Button disabled={busy} onClick={() => setDialog('recreate')}>
                检查并更新受管配置
              </Button>
            </>
          ) : (
            <>
              <p>名称：{p?.profileName}</p>
              <p>Profile ID：{p?.profileId}</p>
              <p>目录：{p?.profilePath}</p>
              <p>
                浏览器：{browserName} · {runtime}
              </p>
              <p>参数来自最近一次浏览器观测；待验证项不会显示为已受保护。</p>
            </>
          )}
          {operation.error && (
            <p role="alert" className={styles.error}>
              {operation.error.message}
            </p>
          )}
        </DetailDialog>
      )}
    </div>
  );
}

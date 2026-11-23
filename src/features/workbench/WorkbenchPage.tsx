import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Globe,
  Home,
  Layers,
  MapPin,
  Minus,
  Monitor,
  Network,
  RefreshCw,
  Settings,
  Shield,
  Square,
  X,
} from 'lucide-react';
import { Surface } from '../../components/ui/Surface';
import { Button } from '../../components/ui/Button';
import type { WindowControls } from '../../core/platform/window';
import {
  formatTime,
  type WorkbenchRecord,
  type WorkbenchService,
} from '../../services/workbench';
import logo from '../../assets/codeseam-logo.svg';
import webIcon from '../../assets/claude-web.png';
import codeIcon from '../../assets/claude-code.png';
import desktopIcon from '../../assets/claude-desktop.png';
import styles from './WorkbenchPage.module.css';
const apps = [
  { id: 'web' as const, name: 'Claude Web', image: webIcon },
  { id: 'code' as const, name: 'Claude Code', image: codeIcon },
  { id: 'desktop' as const, name: 'Claude Desktop', image: desktopIcon },
];

function Detail({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      onCancel={onClose}
      aria-labelledby="detail-title"
    >
      <header>
        <h2 id="detail-title">{title}</h2>
        <button autoFocus onClick={onClose} aria-label="关闭详情">
          <X />
        </button>
      </header>
      {children}
      <Button onClick={onClose}>返回工作台</Button>
    </dialog>
  );
}
export function WorkbenchPage({
  initial,
  service,
  window: controls,
  preview,
}: {
  initial: WorkbenchRecord;
  service: WorkbenchService;
  window: WindowControls;
  preview: boolean;
}) {
  const [record, setRecord] = useState(initial);
  const [detail, setDetail] = useState('');
  const [menu, setMenu] = useState('');
  const [windowError, setWindowError] = useState('');
  const refresh = useMutation({
    mutationFn: () => service.refresh(),
    onSuccess: setRecord,
  });
  const open = useMutation({
    mutationFn: (app: 'web' | 'code' | 'desktop') =>
      app === 'web' ? service.open() : service.install(app),
    onSuccess: setRecord,
  });
  const started = useRef(false);
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      refresh.mutate();
    }
  }, [refresh]);
  const p = record.baseline.profile;
  const observation = record.observation;
  const current =
    !refresh.isPending && !refresh.isError ? observation?.runtime : null;
  const same =
    !!current &&
    current.confirmed &&
    current.revision === record.runtime?.revision;
  const error = refresh.error?.message || open.error?.message || windowError;
  const processes =
    !refresh.isPending && !refresh.isError && !observation?.error
      ? observation?.processes
      : null;
  const counts = processes
    ? Object.values(processes).reduce((sum, item) => sum + item.count, 0)
    : null;
  const lastAt =
    !refresh.isError && !observation?.error ? observation?.at : undefined;
  const environmentTitle = refresh.isPending
    ? '正在检测当前环境'
    : same
      ? '环境保护待验证'
      : current
        ? '环境变化，需要确认'
        : '当前环境待验证';
  const state = (id: 'web' | 'code' | 'desktop') => {
    const app = processes?.[id];
    if (!app) return '状态待检测';
    if (app.count > 0) return '运行中 · 待验证';
    return id === 'web' ? '已就绪' : app.installed ? '未运行' : '未安装';
  };
  const actWindow = (fn: () => Promise<void>) => {
    void fn().catch((e: Error) => setWindowError(e.message));
  };
  const latest = record.events.slice(-7).reverse();
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <img src={logo} alt="CodeSeam" draggable={false} />
        <nav aria-label="主导航">
          {[
            { name: '工作台', icon: Home },
            { name: '运行环境', icon: Layers },
            { name: '节点与代理', icon: Network },
            { name: '专用浏览器', icon: Globe },
          ].map(({ name, icon: Icon }) => (
            <button
              key={name}
              title={name}
              aria-label={name}
              aria-current={name === '工作台' && !detail ? 'page' : undefined}
              className={name === '工作台' && !detail ? styles.active : ''}
              onClick={() => {
                setMenu('');
                setDetail(name === '工作台' ? '' : name);
              }}
            >
              <Icon />
            </button>
          ))}
        </nav>
        <button
          title="设置"
          aria-label="设置"
          className={styles.settings}
          onClick={() => setDetail('设置')}
        >
          <Settings />
        </button>
      </aside>
      <header className={styles.titlebar} data-tauri-drag-region>
        {preview && <small>开发预览 · 数据为演示场景</small>}
        <div>
          <button
            aria-label="最小化"
            onClick={() => actWindow(controls.minimize)}
          >
            <Minus size={18} />
          </button>
          <button
            aria-label="最大化或还原"
            onClick={() => actWindow(controls.maximize)}
          >
            <Square size={16} />
          </button>
          <button
            aria-label="关闭"
            className={styles.close}
            onClick={() => actWindow(controls.close)}
          >
            <X size={22} />
          </button>
        </div>
      </header>
      <main className={styles.main}>
        <header className={styles.heading}>
          <h1>工作台</h1>
          <div className={styles.identity}>
            <button onClick={() => setDetail('运行环境')}>
              <Monitor />
              <span>当前 Runtime</span>
              <strong>{p.runtime}</strong>
            </button>
            <button onClick={() => setDetail('节点与代理')}>
              <MapPin />
              <span>出口节点</span>
              <strong>{current?.node.name ?? p.nodeName}</strong>
            </button>
            <button onClick={() => setDetail('节点与代理')}>
              <Network />
              <strong>{current?.node.exitIp ?? '当前出口待检测'}</strong>
            </button>
          </div>
        </header>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <Surface className={styles.statusBar}>
          <div>
            <Monitor size={36} />
            <strong>{environmentTitle}</strong>
            <span>
              {same
                ? '已读取当前环境，保护路径尚未验证'
                : '正式基线已保存，请核对当前观测'}
            </span>
            <button
              className={styles.iconButton}
              title="环境详情"
              aria-label="环境详情"
              onClick={() => setDetail('环境详情')}
            >
              <Layers />
            </button>
          </div>
          <div>
            <Shield size={39} />
            <strong>Guardian 待验证</strong>
            <span>持续守护尚未接通</span>
            <button
              className={styles.iconButton}
              title="重新检测"
              aria-label="重新检测"
              disabled={refresh.isPending || open.isPending}
              onClick={() => refresh.mutate()}
            >
              <RefreshCw className={refresh.isPending ? styles.spinning : ''} />
            </button>
          </div>
        </Surface>
        <Surface className={styles.apps}>
          <h2>Claude 应用</h2>
          <div className={styles.appGrid}>
            {apps.map(({ id, name, image }) => (
              <div key={id} className={styles.app}>
                <img className={styles.appIcon} src={image} alt="" />
                <div className={styles.appName}>
                  <strong>{name}</strong>
                  <span>
                    <i
                      className={
                        id === 'web' && processes ? styles.readyDot : ''
                      }
                    />
                    {state(id)}
                  </span>
                </div>
                <div className={styles.actionWrap}>
                  <div className={styles.split}>
                    <button
                      disabled={refresh.isPending || open.isPending}
                      onClick={() =>
                        id === 'web' || (processes && !processes[id].installed)
                          ? open.mutate(id)
                          : setDetail(name)
                      }
                    >
                      {id === 'web'
                        ? '打开'
                        : !processes || processes[id].installed
                          ? '查看'
                          : '去安装'}
                    </button>
                    <button
                      aria-label={`${name} 更多操作`}
                      aria-expanded={menu === id}
                      onClick={() => setMenu(menu === id ? '' : id)}
                    >
                      <ChevronDown size={17} />
                    </button>
                  </div>
                  {menu === id && (
                    <div className={styles.menu}>
                      <button
                        onClick={() => {
                          setDetail(name);
                          setMenu('');
                        }}
                      >
                        查看详情
                      </button>
                      <button
                        disabled={refresh.isPending}
                        onClick={() => {
                          refresh.mutate();
                          setMenu('');
                        }}
                      >
                        重新检测
                      </button>
                      {id === 'web' && (
                        <button
                          onClick={() => {
                            setDetail('专用浏览器');
                            setMenu('');
                          }}
                        >
                          浏览器环境
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Surface>
        <div className={styles.middle}>
          <Surface className={styles.processes}>
            <h2>
              <Layers />
              进程与守护
            </h2>
            <div className={styles.stats}>
              {[
                { label: '运行中实例', count: counts },
                { label: '已受守护', count: 0 },
                { label: '待验证', count: counts },
                { label: '未覆盖', count: null },
              ].map(({ label, count }) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{count ?? '—'}</strong>
                </div>
              ))}
            </div>
            <div className={styles.processRows}>
              {[apps[1], apps[0], apps[2]].map(({ id, name, image }) => (
                <button
                  key={id}
                  onClick={() => setDetail(`${name} · 进程详情`)}
                >
                  <img className={styles.processIcon} src={image} alt="" />
                  <strong>{name}</strong>
                  <span>
                    <i />
                    {processes?.[id].count === 0 && id === 'web'
                      ? '未运行'
                      : state(id)}
                  </span>
                  <ChevronRight size={21} />
                </button>
              ))}
            </div>
          </Surface>
          <Surface className={styles.risks}>
            <h2>
              <Shield />
              风险与提醒
            </h2>
            <ul>
              <li>
                <CircleAlert />
                持续 Guardian 尚未接通，保护状态待验证
              </li>
              <li>
                <CircleAlert />
                {observation?.error ||
                  (same
                    ? '当前环境已读取，DNS / 时区 / 指纹需持续复验'
                    : '尚未确认当前环境与正式基线一致')}
              </li>
              <li>
                {current?.node.exitIp === p.verification?.exitIp ? (
                  <CircleCheck className={styles.success} />
                ) : (
                  <CircleAlert />
                )}{' '}
                {current?.node.exitIp === p.verification?.exitIp
                  ? '本次出口观测与已确认基线一致'
                  : '当前出口与基线的一致性待复验'}
              </li>
              <li>
                <CircleAlert />
                发现进程后仍需验证真实网络路径
              </li>
            </ul>
          </Surface>
        </div>
        <Surface className={styles.events}>
          <header>
            <h2>
              <Activity />
              守护动态
            </h2>
            <Button onClick={() => setDetail('全部守护记录')}>
              查看全部守护记录
              <ChevronRight size={20} />
            </Button>
          </header>
          {latest.length ? (
            <ol>
              {latest.map((event, index) => (
                <li key={`${event.at}-${index}`}>
                  <i
                    className={
                      event.level === 'success'
                        ? styles.readyDot
                        : event.level === 'warning'
                          ? styles.warningDot
                          : ''
                    }
                  />
                  <time>{formatTime(event.at)}</time>
                  <span>{event.message}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.empty}>
              暂无守护记录，检测与确认后的事件将在这里显示。
            </p>
          )}
        </Surface>
      </main>
      <footer className={styles.footer}>
        <Shield />
        <strong>守护待验证</strong>
        <span>
          最后检测：{refresh.isPending ? '检测中…' : formatTime(lastAt)}
        </span>
        <b>版本 v{__APP_VERSION__}</b>
      </footer>
      {detail && (
        <Detail title={detail} onClose={() => setDetail('')}>
          {detail === '全部守护记录' ? (
            <EventHistory events={record.events} />
          ) : detail === '设置' ? (
            <>
              <h3>常规</h3>
              <p>CodeSeam v{__APP_VERSION__} · 本地独立应用</p>
              <p>
                持续 Guardian
                和系统托盘尚未接通，关闭窗口会退出当前应用。更新、备份及通知偏好将在后续设置功能中提供。
              </p>
              <p>
                当前正式基线和本地账号备注使用 Windows 当前用户加密存储保存。
              </p>
            </>
          ) : detail.startsWith('Claude Code') ||
            detail.startsWith('Claude Desktop') ? (
            <>
              <p>
                {detail.startsWith('Claude Code')
                  ? state('code')
                  : state('desktop')}{' '}
                · 当前正式 Runtime：{p.runtime}
              </p>
              <p>
                应用进程的启动、停止与真实网络路径保护尚未接通，发现进程不代表已受守护。
              </p>
              <p>可通过专用浏览器访问官方安装入口；安装完成后重新检测。</p>
              <Button
                disabled={open.isPending}
                onClick={() =>
                  open.mutate(
                    detail.startsWith('Claude Code') ? 'code' : 'desktop',
                  )
                }
              >
                打开官方安装入口
                <ArrowRight size={18} />
              </Button>
              <p>将使用当前 Runtime 的专用浏览器，不会自动下载或安装应用。</p>
              {open.isSuccess &&
                open.variables ===
                  (detail.startsWith('Claude Code') ? 'code' : 'desktop') && (
                  <p role="status">已请求打开官方安装入口。</p>
                )}
              {open.error && (
                <p role="alert" className={styles.error}>
                  {open.error.message}
                </p>
              )}
            </>
          ) : (
            <>
              <dl className={styles.details}>
                <div>
                  <dt>当前 Runtime</dt>
                  <dd>{p.runtime} · 唯一正式运行环境</dd>
                </div>
                <div>
                  <dt>账号别名</dt>
                  <dd>{record.alias || '未填写'}</dd>
                </div>
                <div>
                  <dt>服务地区</dt>
                  <dd>{record.region || '未填写'}（用户声明，未经资格验证）</dd>
                </div>
                <div>
                  <dt>最近确认</dt>
                  <dd>
                    {formatTime(record.confirmedAt)} · 基线 v{record.schema}
                  </dd>
                </div>
                <div>
                  <dt>已确认节点</dt>
                  <dd>
                    {p.nodeName} · {p.verification?.exitIp || '未知'}
                  </dd>
                </div>
                <div>
                  <dt>当前出口</dt>
                  <dd>{current?.node.exitIp || '尚未取得有效观测'}</dd>
                </div>
                <div>
                  <dt>专用 Profile</dt>
                  <dd>
                    {p.profileName} · {p.browserName} {p.version}
                  </dd>
                </div>
                <div>
                  <dt>初始化时区 / 语言</dt>
                  <dd>
                    {p.verification?.observed.timezone} /{' '}
                    {p.verification?.observed.language}
                  </dd>
                </div>
                {Object.entries(p.verification?.network ?? {}).map(
                  ([key, value]) => (
                    <div key={key}>
                      <dt>{key.toUpperCase()}（初始化）</dt>
                      <dd>{value}</dd>
                    </div>
                  ),
                )}
              </dl>
              <p>
                以上初始化证据不会自动覆盖正式基线。持续守护和进程保护路径尚未验收，当前不能据此判定已受保护。
              </p>
              {observation?.error && (
                <p role="alert" className={styles.error}>
                  {observation.error}
                </p>
              )}
              {current?.checks.map((check) => (
                <p key={check.id}>
                  <strong>{check.label}：</strong>
                  {check.value} ·{' '}
                  {check.status === 'satisfied'
                    ? '本次检测通过'
                    : '待处理 / 无法确认'}
                </p>
              ))}
              {detail.startsWith('Claude Web') && (
                <Button
                  onClick={() => open.mutate('web')}
                  disabled={open.isPending}
                >
                  打开 Claude Web
                </Button>
              )}
            </>
          )}
        </Detail>
      )}
    </div>
  );
}
function EventHistory({ events }: { events: WorkbenchRecord['events'] }) {
  const [level, setLevel] = useState('all');
  return (
    <>
      <label className={styles.filter}>
        事件等级
        <select value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="all">全部</option>
          <option value="warning">提醒</option>
          <option value="success">成功</option>
          <option value="info">信息</option>
        </select>
      </label>
      <ol className={styles.history}>
        {events
          .filter((event) => level === 'all' || event.level === level)
          .slice()
          .reverse()
          .map((event, index) => (
            <li key={index}>
              <time>{formatTime(event.at)}</time>
              <span>{event.message}</span>
            </li>
          ))}
      </ol>
    </>
  );
}

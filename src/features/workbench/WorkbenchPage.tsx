import { Select } from '../../components/ui/Select';
import { PanelTitle } from '../../components/layout/PanelTitle';
import { RuntimeIdentity } from '../../components/business/RuntimeIdentity';
import { useState } from 'react';
import {
  Activity,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Layers,
  Monitor,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { WorkspacePanel } from '../../components/layout/WorkspacePanel';
import { WorkspaceHeader } from '../../components/layout/WorkspaceHeader';
import { DetailDialog } from '../../components/ui/DetailDialog';
import { Button } from '../../components/ui/Button';
import { formatTime, type WorkbenchRecord } from '../../services/workbench';
import type { WorkbenchModel } from './useWorkbench';
import webIcon from '../../assets/claude-web.png';
import codeIcon from '../../assets/claude-code.png';
import desktopIcon from '../../assets/claude-desktop.png';
import styles from './WorkbenchPage.module.css';
const apps = [
  { id: 'web' as const, name: 'Claude Web', image: webIcon },
  { id: 'code' as const, name: 'Claude Code', image: codeIcon },
  { id: 'desktop' as const, name: 'Claude Desktop', image: desktopIcon },
];

export function WorkbenchPage({
  model,
  detail,
  setDetail,
}: {
  model: WorkbenchModel;
  detail: string;
  setDetail: (value: string) => void;
}) {
  const [menu, setMenu] = useState('');
  const {
    record,
    refresh,
    open,
    p,
    observation,
    current,
    exitIp,
    nodeName,
    same,
    error,
    processes,
    counts,
    environmentTitle,
    state,
    latest,
  } = model;
  return (
    <>
      <WorkspaceHeader title="工作台">
        <RuntimeIdentity
          runtime={p.runtime}
          node={nodeName ?? '待检测'}
          exitIp={exitIp ?? '当前出口待检测'}
          onRuntime={() => setDetail('运行环境')}
          onNode={() => setDetail('节点与代理')}
        />
      </WorkspaceHeader>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <WorkspacePanel className={styles.statusBar}>
        <div>
          <Monitor size={36} />
          <strong>{environmentTitle}</strong>
          <span>{same ? '保护路径尚未验证' : '请核对当前环境与基线'}</span>
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
          <ShieldCheck size={39} />
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
      </WorkspacePanel>
      <WorkspacePanel className={styles.apps}>
        <PanelTitle className={styles.sectionTitle}>Claude 应用</PanelTitle>
        <div className={styles.appGrid}>
          {apps.map(({ id, name, image }) => (
            <div key={id} className={styles.app}>
              <img className={styles.appIcon} src={image} alt="" />
              <div className={styles.appName}>
                <strong>{name}</strong>
                <span>
                  <i
                    className={id === 'web' && processes ? styles.readyDot : ''}
                  />
                  {state(id)}
                </span>
              </div>
              <div className={styles.actionWrap}>
                <div
                  className={`${styles.split} ${id === 'web' ? styles.primary : ''}`}
                >
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
      </WorkspacePanel>
      <div className={styles.middle}>
        <WorkspacePanel className={styles.processes}>
          <PanelTitle className={styles.sectionTitle}>
            <Layers />
            进程与守护
          </PanelTitle>
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
              <button key={id} onClick={() => setDetail(`${name} · 进程详情`)}>
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
        </WorkspacePanel>
        <WorkspacePanel className={styles.risks}>
          <PanelTitle className={styles.sectionTitle}>
            <ShieldCheck />
            风险与提醒
          </PanelTitle>
          <ul>
            <li>
              <CircleAlert />
              Guardian 未接通，保护状态待验证
            </li>
            <li>
              <CircleAlert />
              {observation?.error ||
                (same
                  ? 'DNS / 时区 / 指纹需持续复验'
                  : '尚未确认当前环境与正式基线一致')}
            </li>
            <li>
              {!!exitIp && exitIp === p.verification?.exitIp ? (
                <CircleCheck className={styles.success} />
              ) : (
                <CircleAlert />
              )}{' '}
              {!!exitIp && exitIp === p.verification?.exitIp
                ? '本次出口观测与已确认基线一致'
                : '当前出口与基线的一致性待复验'}
            </li>
            <li>
              <CircleAlert />
              发现进程后仍需验证真实网络路径
            </li>
          </ul>
        </WorkspacePanel>
      </div>
      <WorkspacePanel className={styles.events}>
        <header>
          <PanelTitle className={styles.sectionTitle}>
            <Activity />
            守护动态
          </PanelTitle>
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
      </WorkspacePanel>
      {detail && (
        <DetailDialog title={detail} onClose={() => setDetail('')}>
          {detail === '全部守护记录' ? (
            <EventHistory events={record.events} />
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
                  <dd>{exitIp || '尚未取得有效观测'}</dd>
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
        </DetailDialog>
      )}
    </>
  );
}
function EventHistory({ events }: { events: WorkbenchRecord['events'] }) {
  const [level, setLevel] = useState('all');
  return (
    <>
      <label className={styles.filter}>
        事件等级
        <Select value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="all">全部</option>
          <option value="warning">提醒</option>
          <option value="success">成功</option>
          <option value="info">信息</option>
        </Select>
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

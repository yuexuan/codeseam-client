import { useQuery } from '@tanstack/react-query';
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
import type { BrowserService } from '../../services/browser';
import { Surface } from '../../components/ui/Surface';
import { Button } from '../../components/ui/Button';
import { BackButton } from '../../components/ui/BackButton';
import { WizardActions } from '../../components/layout/WizardActions';
import { StatusLabel } from '../../components/ui/StatusLabel';
import styles from './BrowserPage.module.css';
export function BrowserPage({
  service,
  virtualRuntime,
  onBack,
}: {
  service: BrowserService;
  virtualRuntime: boolean;
  onBack: () => void;
}) {
  const [browser, setBrowser] = useState('');
  const result = useQuery({
    queryKey: ['browser', virtualRuntime, browser],
    queryFn: () => service.prepare(virtualRuntime, browser),
    staleTime: 0,
    gcTime: 0,
  });
  const p = result.data?.profile;
  const busy = result.isFetching;
  const tasks = [
    {
      icon: Monitor,
      label: '检测浏览器',
      value: p
        ? `${p.browserName} · 已安装`
        : '检测当前 Runtime 中的 Chrome / Edge',
      done: !!p,
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
      value: p ? `${p.nodeName} · 待接通受管代理` : '继承第二步所选节点',
      done: false,
    },
    {
      icon: Puzzle,
      label: '应用浏览器参数',
      value: '语言、时区、浏览器能力与权限',
      done: false,
    },
    {
      icon: ExternalLink,
      label: '创建 Claude 快捷方式',
      value: '等待受管启动入口',
      done: false,
    },
    {
      icon: Globe,
      label: '浏览器网络验证',
      value: 'DNS / DoH、IPv4 / IPv6、WebRTC / QUIC',
      done: false,
    },
    {
      icon: FileCheck,
      label: '生成候选基线',
      value: '等待浏览器级验证结果',
      done: false,
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
      ],
    ],
    [
      '环境继承',
      [
        ['语言', p?.language],
        ['时区', p?.timezone],
        ['User-Agent / 分辨率', '待浏览器实时观测'],
      ],
    ],
    [
      '设备与权限',
      [
        ['摄像头 / 麦克风', '遵循浏览器权限 · 待观测'],
        ['位置信息', '遵循浏览器权限 · 待观测'],
      ],
    ],
    [
      '图形能力',
      [
        ['Canvas / WebGL', '读取真实能力 · 待观测'],
        ['AudioContext', '读取真实能力 · 待观测'],
      ],
    ],
    [
      '网络与防护',
      [
        ['当前节点', p?.nodeName],
        ['代理绑定', '待完成'],
        ['DNS / DoH、WebRTC', '待浏览器验证'],
      ],
    ],
  ] as const;
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>准备专用浏览器</h1>
        <p>
          自动为当前 Runtime 创建 Claude 专用 Profile，并完成浏览器环境检测。
        </p>
      </header>
      <div className={styles.columns}>
        <Surface className={styles.tasks}>
          <div className={styles.progress}>
            <progress aria-label="浏览器准备进度" max={100} value={percent} />
            <strong>{percent}%</strong>
          </div>
          <div aria-live="polite">
            {tasks.map(({ icon: Icon, label, value, done }, index) => (
              <div className={styles.task} key={label}>
                <Icon className={styles.icon} size={27} />
                <strong>{label}</strong>
                <span className={styles.value}>{value}</span>
                <StatusLabel
                  status={
                    done
                      ? 'satisfied'
                      : busy && index === 0
                        ? 'scanning'
                        : 'pending'
                  }
                  label={
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
              </div>
            ))}
          </div>
          {result.isError && (
            <p role="alert" className={styles.error}>
              {result.error.message}
            </p>
          )}
          {p && (
            <p className={styles.note}>
              Profile
              已准备。当前版本尚未实现代理绑定、受管快捷方式和浏览器实时验证，因此进度停在
              38%，无法进入下一步；重新创建 Profile 无法解除此阻塞。
            </p>
          )}
        </Surface>
        <Surface className={styles.parameters}>
          <div className={styles.panelTitle}>
            <h2>
              <Monitor size={26} />
              浏览器参数
            </h2>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => void result.refetch()}
            >
              <RefreshCw size={17} />
              {busy ? '准备中…' : '重新创建'}
            </Button>
          </div>
          <label className={styles.browser}>
            浏览器
            <select
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
            </select>
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
            <Button disabled title="受管启动与浏览器实时探针尚未接通">
              <ExternalLink size={21} />
              打开验证
            </Button>
          </div>
        </Surface>
      </div>
      <WizardActions>
        <BackButton disabled={busy} onClick={onBack} />
        <p className={styles.privacy}>
          <Info size={19} />
          专用 Profile 独立保存登录状态，不读取或修改日常浏览器数据。
        </p>
        <Button variant="primary" disabled>
          下一步
          <ArrowRight size={23} />
        </Button>
      </WizardActions>
    </div>
  );
}

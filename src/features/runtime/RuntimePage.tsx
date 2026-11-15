import { StatusLabel } from '../../components/ui/StatusLabel';
import { WizardActions } from '../../components/layout/WizardActions';
import { Select } from '../../components/ui/Select';
import { Radio } from '../../components/ui/Radio';
import { BackButton } from '../../components/ui/BackButton';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Layers,
  Monitor,
  Clock,
  Languages,
  Globe,
  RefreshCw,
  Shield,
  Network,
  Settings,
  Pencil,
  ArrowRight,
  Info,
} from 'lucide-react';
import type { RuntimeService } from '../../services/runtime';
import type { RuntimeSetting } from '../../bindings/commands';
import { Button } from '../../components/ui/Button';
import { Surface } from '../../components/ui/Surface';
import styles from './RuntimePage.module.css';
import { HyperVPage } from './HyperVPage';
import { VirtualPage } from './VirtualPage';

const icons = {
  exit: Network,
  timezone: Clock,
  language: Languages,
  culture: Globe,
  time_sync: RefreshCw,
  dns: Shield,
  ipv6: Network,
  udp: Monitor,
};
const settings: { id: RuntimeSetting; label: string; check: string }[] = [
  { id: 'timezone', label: '时区设置', check: 'timezone' },
  { id: 'language', label: '系统语言', check: 'language' },
  { id: 'dns', label: 'DNS 配置', check: 'dns' },
  { id: 'ipv6', label: 'IPv6 设置', check: 'ipv6' },
  { id: 'time_sync', label: '时间同步', check: 'time_sync' },
];
export function RuntimePage({
  service,
  onBack,
  onContinue,
  onVirtualChange,
}: {
  service: RuntimeService;
  onBack: () => void;
  onContinue: () => void;
  onVirtualChange: (virtual: boolean) => void;
}) {
  const client = useQueryClient();
  const [dns, setDns] = useState('cloudflare');
  const [message, setMessage] = useState('');
  const [phase, setPhase] = useState<
    'choose' | 'native' | 'compatibility' | 'virtual'
  >('choose');
  const [mode, setMode] = useState('native');
  const [settingsOpened, setSettingsOpened] = useState(false);
  const report = useQuery({
    queryKey: ['runtime'],
    queryFn: () => service.read(),
    gcTime: 0,
    enabled: phase === 'choose' || phase === 'native',
  });
  const confirmation = useMutation({
    mutationFn: () => {
      if (!report.data) throw new Error('请先完成环境检测');
      return service.confirm(report.data.revision);
    },
    onSuccess: onContinue,
    onError: () => {
      void report.refetch();
    },
  });
  const opening = useMutation({
    mutationFn: (setting: RuntimeSetting) => service.openSetting(setting),
    onSuccess: () => {
      setSettingsOpened(true);
    },
  });
  const applying = useMutation({
    mutationFn: (setting: RuntimeSetting) => {
      if (!report.data) throw new Error('请先完成检测');
      return service.applySetting(
        setting,
        report.data.revision,
        setting === 'timezone'
          ? targetTimezone
          : setting === 'dns'
            ? dns
            : undefined,
      );
    },
    onMutate: () => {
      setMessage('');
      opening.reset();
      confirmation.reset();
    },
    onSuccess: (updated, setting) => {
      client.setQueryData(['runtime'], updated);
      setSettingsOpened(false);
      setMessage(
        setting === 'ipv6'
          ? '已关闭全部可配置网卡的 IPv6；系统级配置将在重启后完全生效。'
          : '设置已应用，并已重新读取本机环境。',
      );
    },
    onError: () => {
      void report.refetch();
    },
  });
  const data = report.data;
  const targetTimezone = data?.targetTimezone ?? '';
  const busy =
    report.isFetching ||
    confirmation.isPending ||
    opening.isPending ||
    applying.isPending;
  const error =
    report.error ?? confirmation.error ?? opening.error ?? applying.error;
  const refresh = () => {
    confirmation.reset();
    opening.reset();
    applying.reset();
    setMessage('');
    void report.refetch().then((result) => {
      if (result.isSuccess) setSettingsOpened(false);
    });
  };
  if (phase === 'compatibility')
    return (
      <HyperVPage
        service={service}
        onBack={() => {
          setPhase('choose');
          onVirtualChange(false);
        }}
        onContinue={() => setPhase('virtual')}
      />
    );
  if (phase === 'virtual')
    return (
      <VirtualPage
        service={service}
        onBack={() => setPhase('compatibility')}
        onContinue={onContinue}
      />
    );
  return (
    <div
      className={`${styles.page} ${phase === 'native' ? styles.native : ''}`}
    >
      <header className={styles.header}>
        <div>
          <h1>{phase === 'choose' ? '运行环境' : '运行环境 · 本机运行'}</h1>
          <p>
            {phase === 'choose'
              ? '根据已选出口，检查系统环境并选择运行方式。'
              : '自动检测本机系统是否与当前节点匹配，全部达标后即可继续。'}
          </p>
        </div>
        <div className={styles.node}>
          当前节点：<strong>{data?.node.name ?? '读取中'}</strong>
          <br />
          <span>
            {data?.node.exitIp ?? '出口待读取'} ·{' '}
            {data?.node.region ?? '地区未知'} · 目标时区：
            {data?.targetTimezone ?? '待检测'}
          </span>
        </div>
      </header>
      {error && (
        <p className={styles.error} role="alert">
          {error.message}
        </p>
      )}
      <div className={styles.columns}>
        <Surface className={styles.panel}>
          <div className={styles.panelTitle}>
            <h2>
              <Layers />
              {phase === 'choose' ? '系统环境检查' : '环境检测结果'}
            </h2>
            <Button aria-label="重新检测" disabled={busy} onClick={refresh}>
              <RefreshCw size={20} />
              {phase === 'native' && '重新检测'}
            </Button>
          </div>
          {report.isFetching && <p role="status">正在读取本机环境…</p>}
          <div className={styles.rows}>
            {data?.checks.map((check) => {
              const Icon = icons[check.id as keyof typeof icons] ?? Info;
              return (
                <div
                  className={styles.row}
                  key={check.id}
                  title={`${check.detail}\n来源：${check.source}`}
                >
                  <Icon className={styles.icon} />
                  <strong>{check.label}</strong>
                  <span className={styles.value}>{check.value}</span>
                  <StatusLabel
                    status={report.isFetching ? 'scanning' : check.status}
                    label={
                      check.status === 'satisfied'
                        ? '匹配'
                        : check.status === 'optional'
                          ? check.id === 'culture'
                            ? '已读取'
                            : '后续检测'
                          : check.status === 'pending'
                            ? check.id === 'timezone' || check.id === 'exit'
                              ? '不一致'
                              : '待处理'
                            : '待检测'
                    }
                  />
                </div>
              );
            })}
          </div>
          {data && (
            <p className={styles.caption}>
              观测时间：
              {new Date(Number(data.observedAt) * 1000).toLocaleString()}
              。检测结果自动决定是否可以继续。
            </p>
          )}
        </Surface>
        <div className={styles.right}>
          {phase === 'choose' ? (
            <Surface className={styles.panel}>
              <h2>
                <Monitor />
                选择运行方式
              </h2>
              <fieldset className={styles.choices}>
                <legend className={styles.srOnly}>运行方式</legend>
                <label
                  className={
                    mode === 'native' ? styles.selected : styles.choice
                  }
                >
                  <Radio
                    name="runtime"
                    value="native"
                    checked={mode === 'native'}
                    onChange={() => setMode('native')}
                  />
                  <Monitor size={39} />
                  <div>
                    <h3>本机运行</h3>
                    <p>在当前 Windows 环境中运行</p>
                    <p className={styles.warning}>
                      下一步可一键设置时区、DNS 和 IPv6
                    </p>
                    <small>
                      按当前节点目标自动判断匹配，需要时由 Windows
                      请求管理员授权。
                    </small>
                  </div>
                </label>
                <label
                  className={
                    mode === 'virtual' ? styles.selected : styles.choice
                  }
                >
                  <Radio
                    name="runtime"
                    value="virtual"
                    checked={mode === 'virtual'}
                    onChange={() => setMode('virtual')}
                  />
                  <Monitor size={39} />
                  <div>
                    <h3>独立虚拟环境</h3>
                    <p>保留本机设置 · 在独立 Windows 环境中运行</p>
                    <small>下一步检查 Hyper-V 兼容性与准备条件。</small>
                  </div>
                </label>
              </fieldset>
            </Surface>
          ) : (
            <Surface className={styles.panel}>
              <h2>
                <Settings />
                本机运行设置
              </h2>
              <div>
                {settings.map((setting) => (
                  <div className={styles.setting} key={setting.id}>
                    <strong>{setting.label}</strong>
                    <div>
                      {setting.id === 'timezone' ? (
                        <span>{targetTimezone || '目标时区待检测'}</span>
                      ) : setting.id === 'dns' ? (
                        <Select
                          aria-label="DNS 方案"
                          value={dns}
                          disabled={busy}
                          onChange={(e) => setDns(e.target.value)}
                        >
                          <option value="cloudflare">
                            Cloudflare · 1.1.1.2 / 1.0.0.2
                          </option>
                          <option value="quad9">
                            Quad9 · 9.9.9.9 / 149.112.112.112
                          </option>
                        </Select>
                      ) : (
                        <span>
                          {data?.checks.find((c) => c.id === setting.check)
                            ?.value ?? '尚未读取'}
                        </span>
                      )}
                    </div>
                    <Button
                      disabled={
                        busy ||
                        !data ||
                        (setting.id === 'timezone' && !targetTimezone)
                      }
                      onClick={() =>
                        setting.id === 'language'
                          ? opening.mutate(setting.id)
                          : applying.mutate(setting.id)
                      }
                    >
                      <Pencil size={18} />
                      {applying.isPending && applying.variables === setting.id
                        ? '正在应用…'
                        : setting.id === 'ipv6'
                          ? '全部关闭'
                          : setting.id === 'time_sync'
                            ? '一键开启'
                            : setting.id === 'language'
                              ? '修改'
                              : '一键设置'}
                    </Button>
                  </div>
                ))}
              </div>
              <p className={styles.notice} role="status">
                <Info size={21} />
                {message ||
                  (settingsOpened
                    ? '语言修改完成后请重新检测。'
                    : '一键应用所选设置，需要时请求管理员授权，完成后自动复查。DNS 作用于已连接网卡；检测匹配后自动解锁继续。')}
              </p>
            </Surface>
          )}
        </div>
      </div>
      <WizardActions>
        <BackButton
          disabled={busy}
          onClick={() => {
            if (phase === 'native') {
              setPhase('choose');
            } else onBack();
          }}
        />
        <Button
          variant="primary"
          disabled={
            busy ||
            (phase === 'choose' && mode === 'virtual'
              ? false
              : report.isError ||
                !data ||
                (phase === 'native' && (!data.ready || settingsOpened)))
          }
          onClick={() => {
            if (phase === 'choose') {
              setPhase(mode === 'virtual' ? 'compatibility' : 'native');
              onVirtualChange(mode === 'virtual');
            } else confirmation.mutate();
          }}
        >
          {confirmation.isPending
            ? '复检中…'
            : phase === 'choose'
              ? '下一步'
              : '继续'}
          <ArrowRight size={23} />
        </Button>
      </WizardActions>
    </div>
  );
}

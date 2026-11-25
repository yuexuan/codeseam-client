import { Checkbox } from '../../components/ui/Checkbox';
import { WizardHeader } from '../../components/layout/WizardHeader';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  CircleAlert,
  Database,
  Globe,
  Info,
  Layers,
  Monitor,
  RefreshCw,
  Search,
  ShieldCheck,
  SquareTerminal,
  Circle,
  Undo2,
  CircleCheck,
} from 'lucide-react';
import { Surface } from '../../components/ui/Surface';
import { Button } from '../../components/ui/Button';
import { BackButton } from '../../components/layout/BackButton';
import { WizardActions } from '../../components/layout/WizardActions';
import type { ClaudeService, CleanupAction } from '../../services/claude';
import styles from './ClaudePage.module.css';
export function ClaudePage({
  service,
  virtualRuntime = false,
  onBack,
  onContinue,
}: {
  service: ClaudeService;
  virtualRuntime?: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  const client = useQueryClient();
  const [excluded, setExcluded] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const report = useQuery({
    queryKey: ['claude', virtualRuntime],
    queryFn: () => service.run('scan'),
  });
  const selected =
    report.data?.items.filter((item) => !excluded.includes(item.id)) ?? [];
  const operation = useMutation({
    mutationFn: (action: CleanupAction) =>
      service.run(
        action,
        selected.map((item) => item.id),
      ),
    onMutate: () => setMessage(''),
    onSuccess: (data, action) => {
      client.setQueryData(['claude', virtualRuntime], data);
      setMessage(
        action === 'restore'
          ? '原配置已恢复并复验。'
          : '备份已校验，所选配置已清理并复验。',
      );
    },
    onError: () => {
      void report.refetch();
    },
  });
  const busy = operation.isPending;
  const scanning = report.isFetching;
  const data = report.data;
  const error = operation.error ?? report.error;
  return (
    <div className={styles.page}>
      <WizardHeader
        title="Claude 配置清理"
        description={<> 清理旧连接与运行配置，为新的运行环境做好准备。 </>}
      />
      {error && (
        <p role="alert" className={styles.error}>
          {error.message}
        </p>
      )}
      {data?.warnings?.map((warning) => (
        <p role="alert" key={warning} className={styles.error}>
          {warning}
        </p>
      ))}
      <div className={styles.columns}>
        <Surface className={styles.main}>
          <div className={styles.title}>
            <h2>
              <Layers />
              发现的旧配置
            </h2>
            <Button
              disabled={busy || scanning}
              onClick={() => {
                operation.reset();
                setMessage('');
                void report.refetch();
              }}
            >
              <RefreshCw size={20} />
              重新扫描
            </Button>
          </div>
          <p className={styles.count}>
            {scanning ? (
              '正在扫描本机 Claude 配置…'
            ) : (
              <>
                检测到 <strong>{data?.items.length ?? 0}</strong> 项待处理配置
              </>
            )}
          </p>
          <div className={styles.items}>
            {data?.items.map((item) => {
              const Icon = item.id === 'desktop' ? Monitor : SquareTerminal;
              return (
                <label className={styles.row} key={item.id}>
                  <Checkbox
                    checked={!excluded.includes(item.id)}
                    disabled={busy || scanning}
                    onChange={(event) =>
                      setExcluded(
                        event.target.checked
                          ? excluded.filter((id) => id !== item.id)
                          : [...excluded, item.id],
                      )
                    }
                  />
                  <span className={styles.appIcon}>
                    <Icon />
                  </span>
                  <span className={styles.description}>
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </span>
                  <span className={styles.pending}>
                    <CircleAlert size={22} />
                    待清理
                  </span>
                </label>
              );
            })}
            {!scanning && data?.items.length === 0 && (
              <p className={styles.empty}>
                <CircleCheck />
                {virtualRuntime
                  ? 'Guest 清理尚未接通，可跳过继续准备浏览器。'
                  : '未发现需要清理的配置，可以直接下一步。'}
              </p>
            )}
          </div>
          <div className={styles.bottom}>
            <p>
              <Info size={20} />
              仅处理已选中的连接配置，不卸载应用，不删除项目与历史数据。
            </p>
            <Button
              variant="primary"
              disabled={busy || scanning || !selected.length}
              onClick={() => operation.mutate('clean')}
            >
              <Database size={24} />
              {busy ? '正在处理…' : `备份并清理 ${selected.length} 项`}
            </Button>
          </div>
        </Surface>
        <div className={styles.right}>
          <Surface className={styles.panel}>
            <h2>
              <Search />
              扫描摘要
            </h2>
            <p>
              已扫描 <strong>2</strong> 款应用
            </p>
            {[
              ['Claude Code', data?.codeInstalled, SquareTerminal],
              ['Claude Desktop', data?.desktopInstalled, Monitor],
            ].map(([name, installed, Icon]) => {
              const AppIcon = Icon as typeof SquareTerminal;
              return (
                <div className={styles.summaryRow} key={String(name)}>
                  <AppIcon />
                  <strong>{String(name)}</strong>
                  <span>
                    {scanning
                      ? '检测中'
                      : installed
                        ? '已安装'
                        : '未检测到安装'}
                  </span>
                </div>
              );
            })}
            <div className={styles.summaryRow}>
              <Globe />
              <span>Claude Web 将在专用浏览器中准备</span>
            </div>
          </Surface>
          <Surface className={styles.panel}>
            <h2>
              <ShieldCheck />
              清理保护
            </h2>
            <dl>
              {[
                ['备份方式', '本地加密备份'],
                ['删除规则', '备份校验后执行'],
                ['用户数据', '项目与历史保留'],
                ['恢复方式', '支持还原'],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p className={styles.progress} role="status">
              {busy
                ? operation.variables === 'restore'
                  ? '正在恢复原配置并复验，请稍候…'
                  : '正在备份、校验、清理并复验，请稍候…'
                : message || '扫描完成，可选择清理或直接跳过'}
            </p>
            <ol className={styles.stages} aria-label="清理流程">
              {['扫描', '备份', '校验', '清理', '复验'].map((label, index) => {
                const done =
                  index === 0
                    ? !!data
                    : operation.isSuccess && operation.variables === 'clean';
                const Icon = done ? CircleCheck : Circle;
                return (
                  <li key={label} className={done ? styles.done : ''}>
                    <Icon size={23} />
                    {label}
                  </li>
                );
              })}
            </ol>
            {data?.canRestore && (
              <>
                <Button
                  disabled={busy || scanning}
                  onClick={() => operation.mutate('restore')}
                >
                  <Undo2 size={20} />
                  恢复清理前配置
                </Button>
                <p className={styles.hint}>
                  备份跨重启保留。配置发生变化时将停止恢复，避免覆盖新设置。
                </p>
              </>
            )}
          </Surface>
        </div>
      </div>
      <WizardActions>
        <BackButton disabled={busy || scanning} onClick={onBack} />
        <div className={styles.actions}>
          {!!data?.items.length && <span>可保留现有配置并跳过</span>}
          <Button
            variant="primary"
            disabled={busy || scanning || !data || report.isError}
            onClick={onContinue}
          >
            {scanning
              ? '正在扫描，请稍候'
              : busy
                ? '处理中，请稍候'
                : data?.items.length
                  ? '跳过并下一步'
                  : '下一步'}
            <ArrowRight size={23} />
          </Button>
        </div>
      </WizardActions>
    </div>
  );
}

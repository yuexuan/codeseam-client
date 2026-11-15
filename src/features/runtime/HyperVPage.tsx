import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Cpu,
  HardDrive,
  Layers,
  MemoryStick,
  RefreshCw,
  ShieldCheck,
  Grid2X2,
  Box,
  CircuitBoard,
} from 'lucide-react';
import type { RuntimeService } from '../../services/runtime';
import { DetectionSummary } from '../../components/ui/DetectionSummary';
import { StatusLabel } from '../../components/ui/StatusLabel';
import { Surface } from '../../components/ui/Surface';
import { Button } from '../../components/ui/Button';
import { BackButton } from '../../components/ui/BackButton';
import { WizardActions } from '../../components/layout/WizardActions';
import styles from './HyperVPage.module.css';

const groups = [
  {
    title: '硬件与固件',
    icon: Cpu,
    rows: [
      ['cpu', 'CPU 虚拟化扩展', Cpu],
      ['slat', 'SLAT（二级地址转换）', Layers],
      ['firmware', 'BIOS / UEFI 虚拟化', CircuitBoard],
      ['memory', '物理内存', MemoryStick],
      ['disk', '可用磁盘', HardDrive],
    ],
  },
  {
    title: 'Windows 环境',
    icon: Grid2X2,
    rows: [
      ['windows', 'Windows 版本', Grid2X2],
      ['hyperv', 'Hyper-V 功能', Box],
      ['admin', '管理员权限', ShieldCheck],
      ['reboot', '重启状态', RefreshCw],
      ['conflict', '虚拟化冲突', Layers],
    ],
  },
] as const;

export function HyperVPage({
  service,
  onBack,
  onContinue,
}: {
  service: RuntimeService;
  onBack: () => void;
  onContinue: () => void;
}) {
  const report = useQuery({
    queryKey: ['hyperv-compatibility'],
    queryFn: () => service.readCompatibility(),
    staleTime: 0,
    gcTime: 0,
  });
  const checks = report.isError ? undefined : report.data;
  const pending =
    checks?.filter((c) => c.status === 'pending' || c.status === 'unsupported')
      .length ?? 0;
  const unsupported = checks?.some((c) => c.status === 'unsupported');
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Hyper-V 兼容性检查</h1>
          <p>检查当前电脑是否满足创建独立 Windows 运行环境的条件。</p>
        </div>
      </header>
      <DetectionSummary
        state={
          report.isFetching
            ? 'scanning'
            : report.isError
              ? 'error'
              : 'completed'
        }
        title={
          report.isFetching
            ? '正在检查兼容性…'
            : report.isError
              ? '兼容性检查未完成'
              : '兼容性检查已完成'
        }
        description={
          report.isError
            ? '请重新检测以获取当前兼容性结果。'
            : '检查硬件与 Windows 环境，接下来将逐项完成准备。'
        }
        counts={
          checks
            ? {
                pending,
                unknown: checks.filter((c) => c.status === 'unknown').length,
                optional: checks.filter((c) => c.status === 'optional').length,
              }
            : undefined
        }
        action={
          <Button
            className={styles.refresh}
            aria-label="重新检测 Hyper-V 兼容性"
            title="重新检测"
            disabled={report.isFetching}
            onClick={() => {
              void report.refetch();
            }}
          >
            <RefreshCw className={report.isFetching ? styles.spin : ''} />
          </Button>
        }
      />
      {report.error && (
        <p className={styles.error} role="alert">
          {report.error.message}
        </p>
      )}
      <div className={styles.columns}>
        {groups.map((group) => (
          <Surface className={styles.panel} key={group.title}>
            <h2>
              <group.icon className={styles.headingIcon} aria-hidden="true" />
              {group.title}
            </h2>
            {group.rows.map(([id, label, Icon]) => {
              const check = checks?.find((c) => c.id === id);
              const state = report.isFetching
                ? 'scanning'
                : (check?.status ?? 'unknown');
              return (
                <div
                  className={styles.row}
                  key={id}
                  title={
                    check ? `${check.detail}\n来源：${check.source}` : undefined
                  }
                >
                  <Icon className={styles.rowIcon} aria-hidden="true" />
                  <strong>{label}</strong>
                  <div className={styles.statusCell}>
                    <StatusLabel
                      status={state}
                      label={check?.value ?? '无法确认'}
                    />
                  </div>
                </div>
              );
            })}
          </Surface>
        ))}
      </div>
      <WizardActions>
        <BackButton onClick={onBack} disabled={report.isFetching} />
        <Button
          variant="primary"
          disabled={
            report.isFetching || report.isError || !checks || unsupported
          }
          title={
            unsupported
              ? '当前系统或硬件不支持 Hyper-V，请查看检测详情'
              : undefined
          }
          onClick={onContinue}
        >
          下一步
          <ArrowRight />
        </Button>
      </WizardActions>
    </div>
  );
}

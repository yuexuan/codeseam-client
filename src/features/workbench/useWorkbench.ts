import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CheckScope,
  WorkbenchRecord,
  WorkbenchService,
} from '../../services/workbench';

export function useWorkbench(
  initial: WorkbenchRecord,
  service: WorkbenchService,
) {
  const [record, setRecord] = useState(initial);
  const client = useQueryClient();
  const [backgroundError, setBackgroundError] = useState('');
  const refresh = useMutation({
    mutationFn: (scope: CheckScope | void) => service.refresh(scope || 'all'),
    onSuccess: (updated) => {
      setBackgroundError('');
      setRecord(updated);
    },
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
      if (!initial.observation) refresh.mutate();
    }
  }, [initial.observation, refresh]);
  const runCheck = refresh.mutate;
  useEffect(() => {
    let active = true;
    let stop: (() => void) | undefined;
    if (service.subscribe) {
      void service
        .subscribe(
          (next) => {
            if (
              active &&
              next.confirmedAt === initial.confirmedAt &&
              next.baselineVersion === initial.baselineVersion
            ) {
              setBackgroundError('');
              setRecord(next);
              void client.invalidateQueries({ queryKey: ['nodes'] });
            }
          },
          (error) => {
            if (active) setBackgroundError(error);
          },
        )
        .then((unsubscribe) => {
          if (active) stop = unsubscribe;
          else unsubscribe();
        })
        .catch((error) => {
          if (active) setBackgroundError(String(error));
        });
    } else {
      const timer = window.setInterval(() => runCheck(), 2 * 60 * 60 * 1000);
      stop = () => window.clearInterval(timer);
    }
    return () => {
      active = false;
      stop?.();
    };
  }, [initial.confirmedAt, initial.baselineVersion, service, runCheck, client]);
  const p = record.baseline.profile;
  const observation = record.observation;
  const current = observation?.runtime;
  const environment = observation?.environment;
  const same =
    !observation?.error &&
    (record.virtualRuntime
      ? !!environment?.online &&
        ['exit', 'dns', 'browser'].every((id) =>
          environment.checks.some(
            (check) => check.id === id && check.status === 'satisfied',
          ),
        )
      : !!current &&
        current.confirmed &&
        current.revision === record.runtime?.revision);
  const exitIp = current?.node.exitIp ?? environment?.exitIp;
  const nodeName =
    current?.node.name ?? (environment?.exitIp ? p.nodeName : undefined);
  const error =
    refresh.error?.message || open.error?.message || backgroundError;
  const processes = observation?.processes;
  const counts = processes
    ? Object.values(processes).reduce((sum, item) => sum + item.count, 0)
    : null;
  const lastAt = observation?.at;
  const environmentTitle =
    refresh.isPending && !lastAt
      ? '正在检测当前环境'
      : same
        ? '环境保护待验证'
        : current || environment
          ? '环境变化，需要确认'
          : '当前环境待验证';
  const state = (id: 'web' | 'code' | 'desktop') => {
    const app = processes?.[id];
    if (!app) return '状态待检测';
    if (app.count > 0) return '运行中 · 待验证';
    return id === 'web' ? '已就绪' : app.installed ? '未运行' : '未安装';
  };
  const latest = record.events.slice(-7).reverse();
  return {
    record,
    setRecord,
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
    lastAt,
    environmentTitle,
    state,
    latest,
  };
}
export type WorkbenchModel = ReturnType<typeof useWorkbench>;

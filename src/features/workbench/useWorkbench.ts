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
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 3000);
    return () => window.clearInterval(timer);
  }, []);
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
  const control = useMutation({
    mutationFn: ({
      app,
      action,
    }: {
      app: 'web' | 'code' | 'desktop';
      action: 'start' | 'stop';
    }) => service.app(app, action),
    onSuccess: setRecord,
  });
  const recover = useMutation({
    mutationFn: () => service.recover(),
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
  const guardianAt = record.guardian?.at;
  const heartbeat = guardianAt
    ? new Date(
        /^\d+$/.test(guardianAt) ? Number(guardianAt) * 1000 : guardianAt,
      ).getTime()
    : 0;
  const fresh =
    Number.isFinite(heartbeat) &&
    now - heartbeat < 20000 &&
    heartbeat - now < 5000;
  const guardian = fresh ? record.guardian : undefined;
  const observation =
    record.guardian && !fresh && record.observation
      ? {
          ...record.observation,
          runtime: null,
          processes: null,
          error: 'Guardian 心跳已过期，当前状态待复验',
          environment: record.observation.environment
            ? {
                ...record.observation.environment,
                online: false,
                state: 'Unknown',
                exitIp: null,
                checks: [],
                error: 'Guardian 心跳已过期，当前状态待复验',
              }
            : undefined,
          browser: {
            at: record.observation.at,
            online: false,
            error: 'Guardian 心跳已过期',
          },
        }
      : record.observation;
  const current = observation?.runtime;
  const environment = observation?.environment;
  const unavailable =
    record.virtualRuntime &&
    (!environment?.online || (record.guardian && !fresh));
  const offline =
    record.virtualRuntime &&
    ['Off', 'Saved', 'Paused', 'Stopping', 'Saving', 'Pausing'].includes(
      environment?.state ?? '',
    );
  const canLaunch =
    !!guardian &&
    ['monitoring', 'limited'].includes(guardian.state) &&
    !unavailable;
  const guardianTitle = offline
    ? 'Guest 已离线'
    : unavailable
      ? 'Guardian 正在复验'
      : guardian?.state === 'monitoring'
        ? 'Guardian 守护中'
        : guardian?.state === 'limited'
          ? 'Guardian 覆盖受限'
          : guardian?.state === 'locked'
            ? 'Guardian 已锁定'
            : guardian?.state === 'offline'
              ? 'Guardian 状态待确认'
              : 'Guardian 正在复验';
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
    control.error?.message ||
    recover.error?.message ||
    refresh.error?.message ||
    open.error?.message ||
    backgroundError;
  const processes =
    unavailable || (record.guardian && !fresh) ? null : observation?.processes;
  const counts = processes
    ? Object.values(processes).reduce((sum, item) => sum + item.count, 0)
    : null;
  const lastAt = observation?.at;
  const environmentTitle =
    refresh.isPending && !lastAt
      ? '正在检测当前环境'
      : offline
        ? '运行环境已离线'
        : unavailable
          ? '正在确认运行状态'
          : same
            ? '当前环境稳定'
            : current || environment
              ? '环境变化，需要确认'
              : '当前环境待验证';
  const state = (id: 'web' | 'code' | 'desktop') => {
    if (offline) return 'Guest 离线';
    if (unavailable) return '状态待确认';
    const app = processes?.[id];
    if (!app) return '状态待检测';
    if (app.count > 0)
      return app.protection === 'covered' && canLaunch
        ? '运行中 · 已受守护'
        : '运行中 · 未覆盖';
    return id === 'web'
      ? canLaunch
        ? '已就绪'
        : '启动已暂停'
      : app.installed
        ? '未运行'
        : '未安装';
  };
  const latest = record.events.slice(-7).reverse();
  return {
    record,
    setRecord,
    refresh,
    open,
    control,
    recover,
    guardian,
    guardianTitle,
    canLaunch,
    offline,
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
    history: (cursor?: string) => service.history(cursor),
  };
}
export type WorkbenchModel = ReturnType<typeof useWorkbench>;

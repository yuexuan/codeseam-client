import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { listen } from '@tauri-apps/api/event';
import { useMutation } from '@tanstack/react-query';
import { DetailDialog } from '../components/ui/DetailDialog';
import { Button } from '../components/ui/Button';
import type { WorkbenchService } from '../services/workbench';
import styles from './ExitDialog.module.css';
const ExitContext = createContext<() => void>(() => {});
export function ExitProvider({
  children,
  service,
  preview,
}: {
  children: ReactNode;
  service: WorkbenchService;
  preview: boolean;
}) {
  const exit = useExitRequest(preview);
  return (
    <ExitContext.Provider value={exit.show}>
      {children}
      <ExitDialog service={service} open={exit.open} onClose={exit.close} />
    </ExitContext.Provider>
  );
}
export const useAppExit = () => useContext(ExitContext);

export function ExitDialog({
  service,
  open,
  onClose,
}: {
  service: WorkbenchService;
  open: boolean;
  onClose: () => void;
}) {
  const exit = useMutation({
    mutationFn: (force: boolean) => service.prepareExit(force),
  });
  const [confirmForce, setConfirmForce] = useState(false);
  if (!open) return null;
  const remaining = exit.data?.remaining ?? [];
  return (
    <DetailDialog
      title="退出 CodeSeam？"
      locked={exit.isPending}
      onClose={() => {
        exit.reset();
        setConfirmForce(false);
        onClose();
      }}
    >
      <p>
        完全退出将关闭当前可识别的 Claude
        应用及其进程，并停止后台环境守护。请先保存工作。
      </p>
      <p>
        专用浏览器登录数据、项目、正式基线和事件记录会保留。普通浏览器、IDE
        和终端父进程不会关闭。
      </p>
      {remaining.length > 0 && (
        <p>
          以下应用尚未退出：
          {remaining.map((item) => `${item.app} (PID ${item.id})`).join('、')}
          。Guardian 继续运行。
        </p>
      )}
      {exit.error && <p role="alert">{exit.error.message}</p>}
      {confirmForce && (
        <p role="alert">强制结束这些 Claude 进程可能丢失未保存的工作。</p>
      )}
      <div className={styles.actions}>
        <Button disabled={exit.isPending} onClick={() => exit.mutate(false)}>
          {exit.isPending
            ? '正在关闭并核验…'
            : remaining.length
              ? '继续等待'
              : '确认退出'}
        </Button>
        {remaining.length > 0 && (
          <Button
            disabled={exit.isPending}
            onClick={() =>
              confirmForce ? exit.mutate(true) : setConfirmForce(true)
            }
          >
            {confirmForce ? '确认强制结束并退出' : '强制结束并退出'}
          </Button>
        )}
        <Button
          disabled={exit.isPending}
          onClick={() => {
            exit.reset();
            setConfirmForce(false);
            onClose();
          }}
        >
          返回 CodeSeam
        </Button>
      </div>
    </DetailDialog>
  );
}
export function useExitRequest(preview: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (preview) return;
    let active = true;
    let stop: (() => void) | undefined;
    void listen('exit-requested', () => {
      if (active) setOpen(true);
    }).then((unsubscribe) => {
      if (active) stop = unsubscribe;
      else unsubscribe();
    });
    return () => {
      active = false;
      stop?.();
    };
  }, [preview]);
  return { open, show: () => setOpen(true), close: () => setOpen(false) };
}

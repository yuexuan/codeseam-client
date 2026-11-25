import { useState } from 'react';
import {
  useIsFetching,
  useIsMutating,
  useMutation,
} from '@tanstack/react-query';
import { WindowShell } from '../components/layout/WindowShell';
import { Button } from '../components/ui/Button';
import { DetailDialog } from '../components/ui/DetailDialog';
import { RuntimePage } from '../features/runtime/RuntimePage';
import { BrowserPage } from '../features/browser/BrowserPage';
import { CompletionPage } from '../features/browser/CompletionPage';
import type { RuntimeService } from '../services/runtime';
import type { RuntimeEnvironmentService } from '../services/runtime/environment';
import type { BrowserResult, BrowserService } from '../services/browser';
import type { ClaudeService } from '../services/claude';
import type { WorkbenchRecord, WorkbenchService } from '../services/workbench';
import type { WindowControls } from '../core/platform/window';
import styles from './RuntimeReconfiguration.module.css';

export function RuntimeReconfiguration({
  record,
  runtime,
  environment,
  browser,
  workbench,
  claude,
  controls,
  preview,
  onComplete,
}: {
  record: WorkbenchRecord;
  runtime: RuntimeService;
  environment: RuntimeEnvironmentService;
  browser: BrowserService;
  workbench: WorkbenchService;
  claude: ClaudeService;
  controls: WindowControls;
  preview: boolean;
  onComplete: (record: WorkbenchRecord) => void;
}) {
  const [step, setStep] = useState(3);
  const [result, setResult] = useState<BrowserResult>();
  const [cancelling, setCancelling] = useState(false);
  const [guestBusy, setGuestBusy] = useState(false);
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const busy = guestBusy || fetching > 0 || mutating > 0;
  const pending = record.reconfiguration;
  if (!pending) throw new Error('缺少运行环境重新配置任务');
  const target = pending.virtualRuntime;
  const cancel = useMutation({
    mutationFn: () => environment.cancel(),
    onSuccess: onComplete,
  });
  return (
    <WindowShell
      window={controls}
      preview={preview}
      step={step}
      virtualRuntime={target}
      footer={null}
    >
      <div className={styles.notice}>
        <span>
          重新配置运行环境 · {record.virtualRuntime ? 'Virtual' : 'Native'} →{' '}
          {target ? 'Virtual' : 'Native'}
          <small>新环境确认前，原正式基线保留，日常应用启动已暂停。</small>
        </span>
        <Button disabled={busy} onClick={() => setCancelling(true)}>
          取消切换
        </Button>
      </div>
      {step === 3 ? (
        <RuntimePage
          service={runtime}
          initialMode={target ? 'virtual' : 'native'}
          onBusyChange={setGuestBusy}
          onBack={() => setCancelling(true)}
          onVirtualChange={() => {}}
          onContinue={() => setStep(4)}
        />
      ) : step === 4 ? (
        <BrowserPage
          service={browser}
          virtualRuntime={target}
          onBack={() => setStep(3)}
          onContinue={(value) => {
            setResult(value);
            setStep(5);
          }}
        />
      ) : (
        result && (
          <CompletionPage
            result={result}
            service={browser}
            workbench={workbench}
            virtualRuntime={target}
            cleanupService={claude}
            onBack={() => setStep(4)}
            onComplete={onComplete}
            reconfiguration
            initialAlias={record.alias}
            initialRegion={record.region}
          />
        )
      )}
      {cancelling && (
        <DetailDialog
          title="取消运行环境切换"
          closeLabel="继续配置"
          locked={busy}
          onClose={() => setCancelling(false)}
        >
          <p>
            取消后保留原正式 Runtime 和数据。已经准备的候选虚拟机或 Profile
            不会自动删除，下次启动应用时会重新检测原环境。
          </p>
          {cancel.error && <p role="alert">{cancel.error.message}</p>}
          <Button disabled={busy} onClick={() => cancel.mutate()}>
            {cancel.isPending ? '正在恢复原环境记录…' : '确认取消切换'}
          </Button>
        </DetailDialog>
      )}
    </WindowShell>
  );
}

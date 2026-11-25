import { useState } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { WindowShell } from '../components/layout/WindowShell';
import { BackButton } from '../components/layout/BackButton';
import { Button } from '../components/ui/Button';
import { nativeWindow, previewWindow } from '../core/platform/window';
import {
  nativeEnvironment,
  type EnvironmentService,
} from '../services/environment';
import { createPreview } from '../services/environment/preview';
import { PreflightPage } from '../features/preflight/PreflightPage';
import { usePreflight } from '../features/preflight/usePreflight';
import { NodesPage } from '../features/nodes/NodesPage';
import { nativeNodes } from '../services/nodes';
import { createNodesPreview } from '../services/nodes/preview';
import styles from './App.module.css';
import { RuntimePage } from '../features/runtime/RuntimePage';
import { VirtualPage } from '../features/runtime/VirtualPage';
import { nativeRuntime } from '../services/runtime';
import { createRuntimePreview } from '../services/runtime/preview';
import {
  nativeRuntimeEnvironment,
  createRuntimeEnvironmentPreview,
} from '../services/runtime/environment';
import { RuntimeReconfiguration } from './RuntimeReconfiguration';
import { ClaudePage } from '../features/claude/ClaudePage';
import { nativeClaude, createClaudePreview } from '../services/claude';
import { BrowserPage } from '../features/browser/BrowserPage';
import {
  nativeBrowser,
  createBrowserPreview,
  type BrowserResult,
} from '../services/browser';
import { CompletionPage } from '../features/browser/CompletionPage';
import { DailyWorkspace } from './DailyWorkspace';
import { WorkspaceStartup } from './WorkspaceStartup';
import {
  nativeDailyBrowser,
  createDailyBrowserPreview,
} from '../services/browser/daily';
import {
  createWorkbenchPreview,
  nativeWorkbench,
  type WorkbenchRecord,
  type WorkbenchService,
} from '../services/workbench';
const workbench: WorkbenchService =
  import.meta.env.DEV &&
  !('__TAURI_INTERNALS__' in window) &&
  new URLSearchParams(location.search).has('preview')
    ? createWorkbenchPreview(
        new URLSearchParams(location.search).get('preview') ?? 'default',
        new URLSearchParams(location.search).get('step') === 'workbench'
          ? new URLSearchParams(location.search).has('virtual')
          : undefined,
        {
          environment: () => environment.read(),
          browser: () => dailyBrowser.read(),
        },
      )
    : nativeWorkbench;
const native = '__TAURI_INTERNALS__' in window;
const scenario = new URLSearchParams(location.search).get('preview');
const preview = import.meta.env.DEV && !native && scenario !== null;
const service: EnvironmentService = preview
  ? createPreview(scenario)
  : nativeEnvironment;
const nodes = preview ? createNodesPreview(scenario ?? 'default') : nativeNodes;
const claude = preview
  ? createClaudePreview(scenario ?? 'default')
  : nativeClaude;
const browser = preview
  ? createBrowserPreview(scenario ?? 'default')
  : nativeBrowser;
const environment = preview
  ? createRuntimeEnvironmentPreview(
      () => workbench.read(),
      scenario ?? 'default',
      nodes,
    )
  : nativeRuntimeEnvironment;
const reconfigurationRuntime = preview ? createRuntimePreview() : nativeRuntime;
const controls = native ? nativeWindow : previewWindow;
const dailyBrowser = preview
  ? createDailyBrowserPreview(() => workbench.read(), scenario ?? 'default')
  : nativeDailyBrowser;
const createClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'always',
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        staleTime: Infinity,
      },
      mutations: { networkMode: 'always', retry: false },
    },
  });
function Content({ onReset }: { onReset: () => void }) {
  const [ready, setReady] = useState<WorkbenchRecord>();
  const [finished, setFinished] = useState<WorkbenchRecord>();
  const [switchRecord, setSwitchRecord] = useState<WorkbenchRecord>();
  const saved = useQuery({
    queryKey: ['workbench'],
    queryFn: () => workbench.read(),
  });
  const [completedBrowser, setCompletedBrowser] = useState<BrowserResult>();
  const [virtualRuntime, setVirtualRuntime] = useState(
    preview && new URLSearchParams(location.search).has('virtual'),
  );
  const { startup, scan } = usePreflight(
    service,
    saved.isSuccess && !saved.data && !finished,
  );
  const [step, setStep] = useState(
    preview && new URLSearchParams(location.search).get('step') === 'browser'
      ? 4
      : preview && new URLSearchParams(location.search).get('step') === 'claude'
        ? 2
        : preview &&
            new URLSearchParams(location.search).get('step') === 'runtime'
          ? 3
          : preview &&
              new URLSearchParams(location.search).get('step') === 'nodes'
            ? 1
            : 0,
  );
  const scanning = scan.isPending;
  const error = startup.error?.message ?? scan.error?.message ?? '';
  const nodeState = useQuery({
    queryKey: ['nodes'],
    queryFn: () => nodes.read(),
  });
  const selectedNode = nodeState.data?.nodes.find(
    (n) => n.id === nodeState.data.selectedId,
  );
  const nodeReady =
    selectedNode?.status === 'connected' &&
    !!selectedNode.exitIp &&
    !nodeState.data?.nodes.some(
      (n) => n.status === 'testing' || n.status === 'queued',
    );

  if (saved.isPending)
    return (
      <div className={styles.unsupported} role="status">
        正在读取本机初始化记录…
      </div>
    );
  if (saved.isError)
    return (
      <div className={styles.unsupported}>
        <h1>无法读取正式环境记录</h1>
        <p role="alert">{saved.error.message}</p>
        <Button onClick={() => void saved.refetch()}>重新读取</Button>
      </div>
    );
  const daily = finished ?? saved.data;
  const candidate =
    switchRecord ?? (daily?.reconfiguration ? daily : undefined);
  if (candidate)
    return (
      <RuntimeReconfiguration
        record={candidate}
        runtime={reconfigurationRuntime}
        environment={environment}
        browser={browser}
        workbench={workbench}
        claude={claude}
        controls={controls}
        preview={preview}
        onComplete={(record) => {
          setReady(undefined);
          setFinished(record);
          setSwitchRecord(undefined);
        }}
      />
    );
  if (daily)
    if (!ready || ready.confirmedAt !== daily.confirmedAt)
      return (
        <WorkspaceStartup
          record={daily}
          environment={environment}
          workbench={workbench}
          controls={controls}
          preview={preview}
          onReady={setReady}
          nodes={nodes}
          onRepaired={(record) => {
            setFinished(record);
            setReady(undefined);
          }}
        />
      );
  if (daily && ready)
    return (
      <DailyWorkspace
        key={`${ready.confirmedAt}:${ready.baselineVersion ?? 1}`}
        browser={dailyBrowser}
        onReset={onReset}
        initial={ready}
        service={workbench}
        window={controls}
        preview={preview}
        environment={environment}
        onReconfigure={setSwitchRecord}
        nodes={nodes}
        onRepaired={(record) => {
          setFinished(record);
          setReady(record);
        }}
      />
    );

  return (
    <WindowShell
      window={controls}
      preview={preview}
      step={step}
      virtualRuntime={virtualRuntime}
      footer={
        step >= 2 ? null : (
          <>
            {step > 0 && <BackButton onClick={() => setStep(step - 1)} />}
            <Button
              variant="primary"
              disabled={
                step === 0
                  ? !scan.data ||
                    scanning ||
                    !!error ||
                    scan.data.checks.some((check) => check.blocking)
                  : step === 1
                    ? !nodeReady
                    : true
              }
              onClick={() => setStep(step + 1)}
            >
              下一步
              <ArrowRight size={23} />
            </Button>
          </>
        )
      }
    >
      {step === 0 ? (
        <PreflightPage
          report={scan.data}
          scanning={scanning}
          error={error}
          onRefresh={() => {
            if (startup.isError) {
              void startup.refetch();
            } else {
              scan.mutate();
            }
          }}
        />
      ) : step === 1 ? (
        <NodesPage service={nodes} />
      ) : preview &&
        step === 3 &&
        new URLSearchParams(location.search).has('virtual') ? (
        <VirtualPage onBack={() => setStep(2)} onContinue={() => setStep(4)} />
      ) : step === 3 && !native ? (
        <section>
          <h1>请在 CodeSeam 桌面应用中检测运行环境</h1>
          <p>
            运行环境检测仅使用本机 Windows
            数据，请安装并打开桌面应用，完成节点出口测试后进入此步骤。
          </p>
          <BackButton onClick={() => setStep(2)} />
        </section>
      ) : step === 3 ? (
        <RuntimePage
          service={nativeRuntime}
          onVirtualChange={setVirtualRuntime}
          onBack={() => setStep(2)}
          onContinue={() => setStep(4)}
        />
      ) : step === 2 ? (
        <ClaudePage
          service={claude}
          virtualRuntime={false}
          onBack={() => setStep(1)}
          onContinue={() => setStep(3)}
        />
      ) : step === 5 && completedBrowser ? (
        <CompletionPage
          result={completedBrowser}
          service={browser}
          virtualRuntime={virtualRuntime}
          onBack={() => setStep(4)}
          workbench={workbench}
          cleanupService={claude}
          onComplete={setFinished}
        />
      ) : (
        <BrowserPage
          service={browser}
          virtualRuntime={virtualRuntime}
          onBack={() => setStep(3)}
          onContinue={(result) => {
            setCompletedBrowser(result);
            setStep(5);
          }}
        />
      )}
    </WindowShell>
  );
}
export function App() {
  const [client] = useState(createClient);
  const [epoch, setEpoch] = useState(0);
  if (!native && !preview)
    return (
      <div className={styles.unsupported}>
        <h1>请在 CodeSeam 桌面应用中打开</h1>
        <p>
          当前浏览器无法读取 Windows 环境。开发时可显式使用 ?preview=default
          预览界面。
        </p>
      </div>
    );
  return (
    <QueryClientProvider client={client}>
      <Content
        key={epoch}
        onReset={() => {
          client.clear();
          setEpoch((value) => value + 1);
        }}
      />
    </QueryClientProvider>
  );
}

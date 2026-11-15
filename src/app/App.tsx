import { useState } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { WindowShell } from '../components/layout/WindowShell';
import { BackButton } from '../components/ui/BackButton';
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
import { ClaudePage } from '../features/claude/ClaudePage';
import {
  nativeClaude,
  virtualClaude,
  createClaudePreview,
} from '../services/claude';
import { BrowserPage } from '../features/browser/BrowserPage';
import { nativeBrowser, createBrowserPreview } from '../services/browser';
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
const controls = native ? nativeWindow : previewWindow;
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
function Content() {
  const [virtualRuntime, setVirtualRuntime] = useState(
    preview && new URLSearchParams(location.search).has('virtual'),
  );
  const { startup, scan } = usePreflight(service);
  const [step, setStep] = useState(
    preview && new URLSearchParams(location.search).get('step') === 'browser'
      ? 4
      : preview && new URLSearchParams(location.search).get('step') === 'claude'
        ? 3
        : preview &&
            new URLSearchParams(location.search).get('step') === 'runtime'
          ? 2
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

  return (
    <WindowShell
      window={controls}
      preview={preview}
      step={step}
      virtualRuntime={virtualRuntime}
      footer={
        step === 2 || step === 3 || step === 4 ? null : (
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
        step === 2 &&
        new URLSearchParams(location.search).has('virtual') ? (
        <VirtualPage onBack={() => setStep(1)} />
      ) : step === 2 && !native ? (
        <section>
          <h1>请在 CodeSeam 桌面应用中检测运行环境</h1>
          <p>
            运行环境检测仅使用本机 Windows
            数据，请安装并打开桌面应用，完成节点出口测试后进入此步骤。
          </p>
          <BackButton onClick={() => setStep(1)} />
        </section>
      ) : step === 2 ? (
        <RuntimePage
          service={nativeRuntime}
          onVirtualChange={setVirtualRuntime}
          onBack={() => setStep(1)}
          onContinue={() => setStep(3)}
        />
      ) : step === 3 ? (
        <ClaudePage
          service={virtualRuntime && !preview ? virtualClaude : claude}
          virtualRuntime={virtualRuntime}
          onBack={() => setStep(2)}
          onContinue={() => setStep(4)}
        />
      ) : (
        <BrowserPage
          service={browser}
          virtualRuntime={virtualRuntime}
          onBack={() => setStep(3)}
        />
      )}
    </WindowShell>
  );
}
export function App() {
  const [client] = useState(createClient);
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
      <Content />
    </QueryClientProvider>
  );
}

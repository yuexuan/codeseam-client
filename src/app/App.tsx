import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { WindowShell } from '../components/layout/WindowShell';
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
const native = '__TAURI_INTERNALS__' in window;
const scenario = new URLSearchParams(location.search).get('preview');
const preview = import.meta.env.DEV && !native && scenario !== null;
const service: EnvironmentService = preview
  ? createPreview(scenario)
  : nativeEnvironment;
const nodes = preview ? createNodesPreview(scenario ?? 'default') : nativeNodes;
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
  const { startup, scan } = usePreflight(service);
  const [step, setStep] = useState(
    preview && new URLSearchParams(location.search).get('step') === 'nodes'
      ? 1
      : 0,
  );
  const scanning = scan.isPending;
  const error = startup.error?.message ?? scan.error?.message ?? '';

  return (
    <WindowShell
      window={controls}
      preview={preview}
      step={step}
      footer={
        <>
          {step === 1 && (
            <Button className={styles.back} onClick={() => setStep(0)}>
              <ArrowLeft size={23} />
              上一步
            </Button>
          )}
          <Button
            variant="primary"
            disabled={
              step === 0
                ? !scan.data ||
                  scanning ||
                  !!error ||
                  scan.data.checks.some((check) => check.blocking)
                : true
            }
            onClick={() => setStep(1)}
          >
            下一步
            <ArrowRight size={23} />
          </Button>
        </>
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
      ) : (
        <NodesPage service={nodes} />
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

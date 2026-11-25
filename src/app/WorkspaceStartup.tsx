import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Globe,
  Layers,
  Monitor,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { WindowShell } from '../components/layout/WindowShell';
import { WizardHeader } from '../components/layout/WizardHeader';
import { CheckRow } from '../components/business/CheckRow';
import { Button } from '../components/ui/Button';
import { Surface } from '../components/ui/Surface';
import type { WindowControls } from '../core/platform/window';
import type { RuntimeEnvironmentService } from '../services/runtime/environment';
import { startWorkspace, type StartupStage } from '../services/runtime/startup';
import type { WorkbenchRecord, WorkbenchService } from '../services/workbench';
import type { NodesService } from '../services/nodes';
import { NodeEditorDialog } from '../features/nodes/NodeEditorDialog';
import styles from './WorkspaceStartup.module.css';

export function WorkspaceStartup({
  record,
  environment,
  workbench,
  controls,
  preview,
  onReady,
  nodes,
  onRepaired,
}: {
  record: WorkbenchRecord;
  environment: RuntimeEnvironmentService;
  workbench: WorkbenchService;
  controls: WindowControls;
  preview: boolean;
  onReady: (record: WorkbenchRecord) => void;
  nodes: NodesService;
  onRepaired: (record: WorkbenchRecord) => void;
}) {
  const [stage, setStage] = useState<StartupStage>('runtime');
  const [editingNodes, setEditingNodes] = useState(false);
  const started = useRef(false);
  const startup = useMutation({
    mutationFn: () => startWorkspace(environment, workbench, setStage),
    onSuccess: onReady,
  });
  const console = useMutation({ mutationFn: () => environment.openConsole() });
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startup.mutate();
  }, [startup]);
  const steps = [
    {
      id: 'runtime',
      icon: Monitor,
      title: record.virtualRuntime ? '启动虚拟机' : '准备本机环境',
      detail: record.virtualRuntime
        ? '自动恢复当前虚拟机，等待 Windows 桌面就绪'
        : '连接当前 Windows 运行环境',
    },
    {
      id: 'connection',
      icon: Globe,
      title: '检查连接与浏览器',
      detail: '复验节点出口、DNS 和专用浏览器配置',
    },
    {
      id: 'workspace',
      icon: Layers,
      title: '准备工作台',
      detail: '读取应用状态和最新环境信息',
    },
  ];
  const active = steps.findIndex((item) => item.id === stage);
  return (
    <WindowShell
      window={controls}
      preview={preview}
      step={null}
      contentClassName={styles.main}
      footer={
        <div className={styles.footer}>
          <span>CodeSeam · v{__APP_VERSION__}</span>
          <span>准备就绪，才开始工作。</span>
        </div>
      }
    >
      <section className={styles.content} aria-label="启动检查">
        <div className={styles.intro} role="status" aria-live="polite">
          <WizardHeader
            title={startup.isError ? '启动需要处理' : '正在准备你的工作环境'}
            description={
              startup.isError
                ? '解决下方问题后，重新启动即可继续。'
                : '就绪后将自动进入工作台，请稍候。'
            }
          />
        </div>
        <p className={styles.runtime}>
          <Monitor size={18} aria-hidden="true" />
          {record.virtualRuntime ? '虚拟机环境 · Virtual' : '本机环境 · Native'}
          {record.alias && ` · ${record.alias}`}
        </p>
        <Surface className={styles.progress}>
          <ol
            className={styles.steps}
            aria-label="启动进度"
            aria-busy={startup.isPending}
          >
            {steps.map((item, index) => (
              <li
                key={item.id}
                aria-current={index === active ? 'step' : undefined}
              >
                <CheckRow
                  descriptionBelow
                  icon={item.icon}
                  label={item.title}
                  value={item.detail}
                  status={
                    index < active
                      ? 'satisfied'
                      : index === active
                        ? startup.isError
                          ? 'pending'
                          : 'scanning'
                        : 'optional'
                  }
                  statusLabel={
                    index < active
                      ? '已完成'
                      : index === active
                        ? startup.isError
                          ? '未完成'
                          : '进行中'
                        : '等待中'
                  }
                />
              </li>
            ))}
          </ol>
        </Surface>
        {startup.isError && (
          <Surface className={styles.recovery}>
            <p role="alert" className={styles.error}>
              {startup.error.message}
            </p>
            <div className={styles.actions}>
              <Button
                variant="primary"
                disabled={console.isPending}
                onClick={() => setEditingNodes(true)}
              >
                <SlidersHorizontal size={18} />
                编辑节点与代理
              </Button>
              <Button
                disabled={startup.isPending || console.isPending}
                onClick={() => {
                  console.reset();
                  startup.mutate();
                }}
              >
                <RefreshCw size={18} />
                {stage === 'runtime' ? '重新启动' : '重新检测'}
              </Button>
              {record.virtualRuntime && (
                <Button
                  disabled={console.isPending}
                  onClick={() => console.mutate()}
                >
                  <Monitor size={18} />
                  {console.isPending ? '正在打开…' : '打开虚拟机窗口'}
                </Button>
              )}
            </div>
            {console.error && (
              <p role="alert" className={styles.error}>
                {console.error.message}
              </p>
            )}
            {console.isSuccess && (
              <p role="status">虚拟机连接窗口已显示，处理完成后请重试。</p>
            )}
          </Surface>
        )}
      </section>
      {editingNodes && (
        <NodeEditorDialog
          service={nodes}
          apply={() => environment.repairNode()}
          onApplied={(updated) => {
            onRepaired(updated);
            setEditingNodes(false);
            console.reset();
            startup.mutate();
          }}
          onClose={() => setEditingNodes(false)}
        />
      )}
    </WindowShell>
  );
}

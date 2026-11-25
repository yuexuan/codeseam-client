import { useState } from 'react';
import {
  WorkspaceShell,
  type WorkspaceDestination,
} from '../components/layout/WorkspaceShell';
import { WorkspaceStatusBar } from '../components/layout/WorkspaceStatusBar';
import type { WindowControls } from '../core/platform/window';
import { WorkbenchPage } from '../features/workbench/WorkbenchPage';
import { useWorkbench } from '../features/workbench/useWorkbench';
import { SettingsPage } from '../features/settings/SettingsPage';
import { EnvironmentPage } from '../features/runtime/EnvironmentPage';
import { DailyBrowserPage } from '../features/browser/DailyBrowserPage';
import { DailyNodesPage } from '../features/nodes/DailyNodesPage';
import type { NodesService } from '../services/nodes';
import {
  browserDetails,
  type DailyBrowserService,
} from '../services/browser/daily';
import type { RuntimeEnvironmentService } from '../services/runtime/environment';
import {
  formatTime,
  type WorkbenchRecord,
  type WorkbenchService,
} from '../services/workbench';

export function DailyWorkspace({
  onReset,
  initial,
  service,
  window,
  preview,
  environment,
  onReconfigure,
  browser,
  nodes,
  onRepaired,
}: {
  onReset: () => void;
  initial: WorkbenchRecord;
  service: WorkbenchService;
  window: WindowControls;
  preview: boolean;
  environment: RuntimeEnvironmentService;
  onReconfigure: (record: WorkbenchRecord) => void;
  browser: DailyBrowserService;
  nodes: NodesService;
  onRepaired: (record: WorkbenchRecord) => void;
}) {
  const model = useWorkbench(initial, service);
  const runtimeData = model.observation?.environment;
  const browserSnapshot = model.observation?.browser;
  const [nodesBusy, setNodesBusy] = useState(false);
  const [page, setPage] = useState<WorkspaceDestination>(
    preview && new URLSearchParams(location.search).get('page') === 'settings'
      ? '设置'
      : preview && new URLSearchParams(location.search).get('page') === 'nodes'
        ? '节点与代理'
        : preview &&
            new URLSearchParams(location.search).get('page') === 'runtime'
          ? '运行环境'
          : preview &&
              new URLSearchParams(location.search).get('page') === 'browser'
            ? '专用浏览器'
            : '工作台',
  );
  const [detail, setDetail] = useState('');
  const navigate = (destination: WorkspaceDestination) => {
    if (nodesBusy) return;
    setPage(
      destination === '设置'
        ? '设置'
        : destination === '运行环境'
          ? '运行环境'
          : destination === '专用浏览器'
            ? '专用浏览器'
            : destination === '节点与代理'
              ? '节点与代理'
              : '工作台',
    );
    setDetail(
      destination === '工作台' ||
        destination === '设置' ||
        destination === '专用浏览器' ||
        destination === '运行环境' ||
        destination === '节点与代理'
        ? ''
        : destination,
    );
  };
  return (
    <WorkspaceShell
      window={window}
      preview={preview}
      active={page}
      onNavigate={navigate}
      navigationLocked={nodesBusy}
      footer={
        <WorkspaceStatusBar
          status="守护待验证"
          lastChecked={
            page === '运行环境'
              ? formatTime(runtimeData?.at)
              : page === '专用浏览器'
                ? formatTime(browserSnapshot?.at)
                : formatTime(model.lastAt)
          }
          version={__APP_VERSION__}
        />
      }
    >
      {page === '设置' ? (
        <SettingsPage
          service={service}
          virtualRuntime={initial.virtualRuntime}
          preview={preview}
          onReset={onReset}
          onBack={() => navigate('工作台')}
          lastChecked={formatTime(model.lastAt)}
        />
      ) : page === '运行环境' ? (
        <EnvironmentPage
          record={model.record}
          service={environment}
          onReconfigure={onReconfigure}
          data={runtimeData}
          checking={model.refresh.isPending}
          error={model.refresh.error?.message ?? model.observation?.error}
          refresh={() => model.refresh.mutate('runtime')}
        />
      ) : page === '专用浏览器' ? (
        <DailyBrowserPage
          record={model.record}
          service={browser}
          data={browserSnapshot ? browserDetails(browserSnapshot) : undefined}
          checking={model.refresh.isPending}
          checkError={
            model.refresh.error?.message ??
            model.observation?.error ??
            undefined
          }
          refresh={() => model.refresh.mutateAsync('browser')}
        />
      ) : page === '节点与代理' ? (
        <DailyNodesPage
          record={model.record}
          service={nodes}
          environment={environment}
          onBusyChange={setNodesBusy}
          onApplied={(updated) => {
            model.setRecord(updated);
            onRepaired(updated);
          }}
        />
      ) : (
        <WorkbenchPage
          model={model}
          detail={detail}
          setDetail={(value) =>
            value === '运行环境' || value === '专用浏览器'
              ? navigate(value)
              : setDetail(value)
          }
        />
      )}
    </WorkspaceShell>
  );
}

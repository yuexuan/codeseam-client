import { PanelTitle } from '../../components/layout/PanelTitle';
import { ProxyFields, type ProxyDraft } from './ProxyFields';
import { TabList } from '../../components/ui/TabList';
import { RuntimeIdentity } from '../../components/business/RuntimeIdentity';
import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUp,
  ArrowUpCircle,
  Cat,
  CheckCircle2,
  Circle,
  Gauge,
  Layers,
  Layers2,
  LayersPlus,
  Link2,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { WorkspaceHeader } from '../../components/layout/WorkspaceHeader';
import { WorkspacePanel } from '../../components/layout/WorkspacePanel';
import { Button } from '../../components/ui/Button';
import { Radio } from '../../components/ui/Radio';
import { DetailDialog } from '../../components/ui/DetailDialog';
import type { NodeSummary } from '../../bindings/commands';
import { checkKernelRelease, type NodesService } from '../../services/nodes';
import {
  baselineNode,
  hasNewerVersion,
  nodeAvailability,
} from '../../services/nodes/model';
import type { RuntimeEnvironmentService } from '../../services/runtime/environment';
import type { WorkbenchRecord } from '../../services/workbench';
import styles from './DailyNodesPage.module.css';

export function DailyNodesPage({
  record,
  service,
  environment,
  onApplied,
  onBusyChange,
}: {
  record: WorkbenchRecord;
  service: NodesService;
  environment: RuntimeEnvironmentService;
  onApplied: (record: WorkbenchRecord) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const client = useQueryClient();
  const id = useId();
  const [tab, setTab] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const address = useRef<HTMLInputElement>(null);
  const [links, setLinks] = useState('');
  const [proxy, setProxy] = useState<Omit<ProxyDraft, 'port'>>({
    protocol: 'socks5',
    server: '',
    username: '',
    password: '',
  });
  const [port, setPort] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<
    | { kind: 'remove' | 'switch'; node: NodeSummary }
    | { kind: 'upgrade' }
    | null
  >(null);
  const state = useQuery({
    queryKey: ['nodes'],
    queryFn: () => service.read(),
  });
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void service
      .subscribe?.((data) => client.setQueryData(['nodes'], data))
      .then((stop) => {
        if (disposed) stop();
        else unsubscribe = stop;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [client, service]);
  const nodes = state.data?.nodes ?? [];
  const current = baselineNode(record, nodes);
  // 进度事件暂时清除测试结果时，保留已确认的国家/地区。
  const country = useRef<{
    revision: string;
    code: string | null;
    region: string | null;
  } | null>(null);
  useEffect(() => {
    if (
      current?.countryCode &&
      country.current?.revision !== record.confirmedAt
    )
      country.current = {
        revision: record.confirmedAt,
        code: current.countryCode,
        region: current.region,
      };
  }, [current, record.confirmedAt]);
  const code =
    record.nodeCountry?.code ??
    current?.countryCode ??
    country.current?.code ??
    null;
  const region =
    record.nodeCountry?.region ??
    current?.region ??
    country.current?.region ??
    '待确认';
  const refresh = () => client.invalidateQueries({ queryKey: ['nodes'] });
  const testing = useMutation({
    mutationFn: (ids: string[]) => service.test(ids),
    onSuccess: () => {
      setNotice('测速完成，节点状态已更新');
      return refresh();
    },
    onError: () => {
      void refresh();
    },
  });
  const importing = useMutation({
    mutationFn: async () => {
      if (tab === 0) return service.importLinks(links.trim());
      if (!proxy.server.trim()) throw new Error('请填写服务器地址');
      if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
        throw new Error('请填写 1–65535 之间的端口');
      return service.importProxy({
        ...proxy,
        server: proxy.server.trim(),
        port: Number(port),
      });
    },
    onSuccess: async (result) => {
      setNotice(
        `新增 ${result.added} 个节点，跳过 ${result.duplicates} 个重复节点`,
      );
      if (tab === 0) setLinks('');
      else {
        setProxy({ ...proxy, server: '', username: '', password: '' });
        setPort('');
      }
      await refresh();
      if (result.added)
        testing.mutate((await service.read()).nodes.map((node) => node.id));
    },
  });
  const switching = useMutation({
    mutationFn: (node: NodeSummary) => environment.switchNode(node.id),
    onSuccess: async (updated) => {
      setDialog(null);
      setNotice('节点已切换，出口与专用浏览器复验通过');
      onApplied(updated);
      await refresh();
    },
    onError: () => {
      void refresh();
    },
  });
  const removal = useMutation({
    mutationFn: (node: NodeSummary) => service.remove(node.id),
    onSuccess: async () => {
      setDialog(null);
      setNotice('节点已删除');
      await refresh();
    },
  });
  const release = useMutation({ mutationFn: checkKernelRelease });
  const busy =
    importing.isPending ||
    testing.isPending ||
    switching.isPending ||
    removal.isPending ||
    nodes.some((node) => ['queued', 'testing'].includes(node.status));
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  const clear = () => {
    importing.reset();
    testing.reset();
    switching.reset();
    removal.reset();
    setNotice('');
  };
  const error =
    state.error ??
    importing.error ??
    testing.error ??
    switching.error ??
    removal.error ??
    release.error;
  const test = (ids: string[]) => {
    clear();
    testing.mutate(ids);
  };
  const at = record.baseline.profile;
  const currentId = current?.id;
  const hasUpdate = hasNewerVersion(
    state.data?.runtime.version,
    release.data?.version,
  );
  return (
    <div className={styles.page} aria-busy={switching.isPending}>
      <WorkspaceHeader title="节点与代理">
        <RuntimeIdentity
          runtime={record.virtualRuntime ? 'Virtual' : 'Native'}
          node={`${at.nodeName} · ${region}`}
          exitIp={at.verification?.exitIp ?? '待检测'}
        />
      </WorkspaceHeader>

      <WorkspacePanel className={styles.kernel}>
        <div className={styles.kernelState}>
          <span className={styles.kernelIcon}>
            <Cat />
            {state.data?.runtime.running && <CheckCircle2 />}
          </span>
          <h2>
            Mihomo{' '}
            {state.data?.runtime.running
              ? '运行正常'
              : state.data?.runtime.version
                ? '按需启动'
                : '状态待检测'}
          </h2>
        </div>
        <span className={styles.version}>
          <Layers2 />
          当前版本 <strong>{state.data?.runtime.version ?? '待检测'}</strong>
        </span>
        <span className={styles.version}>
          <ArrowUpCircle />
          最新{' '}
          <strong>
            {release.isPending
              ? '检查中…'
              : (release.data?.version ?? '待检查')}
          </strong>
        </span>
        <div className={styles.kernelActions}>
          <Button
            variant="outline"
            disabled={busy || release.isPending}
            onClick={() => {
              release.reset();
              release.mutate();
            }}
          >
            <RefreshCw className={release.isPending ? styles.spinning : ''} />
            {release.isPending ? '检查中' : '检查更新'}
          </Button>
          <Button
            variant="primary"
            className={styles.primary}
            disabled={busy || !hasUpdate}
            onClick={() => setDialog({ kind: 'upgrade' })}
          >
            <ArrowUp />
            升级
          </Button>
        </div>
      </WorkspacePanel>

      <WorkspacePanel className={styles.addPanel}>
        <PanelTitle>
          <LayersPlus />
          添加节点
        </PanelTitle>
        <TabList
          id={id}
          label="添加节点方式"
          items={[
            { value: 'clash', label: 'Clash 导入' },
            { value: 'general', label: '通用代理' },
          ]}
          value={tab === 0 ? 'clash' : 'general'}
          disabled={busy}
          onChange={(value) => {
            setTab(value === 'clash' ? 0 : 1);
            clear();
          }}
        />
        <form
          id={`${id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${tab === 0 ? 'clash' : 'general'}`}
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            clear();
            importing.mutate();
          }}
        >
          {tab === 0 ? (
            <div className={styles.importLine}>
              <div className={styles.linkField}>
                <Link2 />
                <textarea
                  ref={input}
                  rows={1}
                  aria-label="订阅链接或节点链接"
                  placeholder="粘贴订阅链接或节点链接"
                  value={links}
                  onChange={(event) => setLinks(event.target.value)}
                  disabled={busy}
                  spellCheck={false}
                />
              </div>
              <Button
                variant="primary"
                type="submit"
                className={styles.primary}
                disabled={busy || !links.trim()}
              >
                {importing.isPending ? (
                  <LoaderCircle className={styles.spinning} />
                ) : (
                  <LogIn />
                )}
                {importing.isPending ? '导入中' : '导入'}
              </Button>
            </div>
          ) : (
            <ProxyFields
              value={{ ...proxy, port }}
              disabled={busy}
              addressRef={address}
              onChange={(draft) => {
                const { port: nextPort, ...nextProxy } = draft;
                setPort(nextPort);
                setProxy(nextProxy);
              }}
              action={
                <Button
                  variant="primary"
                  type="submit"
                  className={styles.primary}
                  disabled={busy}
                >
                  <LogIn />
                  {importing.isPending ? '添加中' : '添加代理'}
                </Button>
              }
            />
          )}
        </form>
      </WorkspacePanel>

      {(error ||
        notice ||
        testing.isPending ||
        (release.isSuccess && !hasUpdate)) && (
        <p
          className={error ? styles.error : styles.notice}
          role={error ? 'alert' : 'status'}
        >
          {error?.message ??
            (testing.isPending
              ? `正在测速 · 已完成 ${nodes.filter((node) => testing.variables?.includes(node.id) && ['connected', 'failed', 'unknown'].includes(node.status)).length} / ${testing.variables?.length ?? 0}`
              : notice || '检查完成，当前版本无需升级')}
        </p>
      )}

      <WorkspacePanel className={styles.listPanel}>
        <div className={styles.listHeading}>
          <PanelTitle>
            <Layers />
            节点列表
          </PanelTitle>
          <span className={styles.country}>当前出口国家：{region}</span>
          <span className={styles.restriction}>
            <LockKeyhole />
            仅可选择同国家节点
          </span>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              (tab === 0 ? input.current : address.current)?.focus();
            }}
          >
            <Plus />
            添加
          </Button>
          <Button
            variant="outline"
            disabled={busy || !nodes.length}
            onClick={() => test(nodes.map((node) => node.id))}
          >
            <Gauge className={testing.isPending ? styles.spinning : ''} />
            {testing.isPending ? '测速中' : '全部测速'}
          </Button>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <colgroup>
              <col className={styles.choiceColumn} />
              <col className={styles.nameColumn} />
              <col />
              <col />
              <col />
              <col className={styles.statusColumn} />
              <col className={styles.actionsColumn} />
            </colgroup>
            <thead>
              <tr>
                <th aria-label="选择节点" />
                <th scope="col">节点名</th>
                <th scope="col">国家</th>
                <th scope="col">协议</th>
                <th scope="col">延迟</th>
                <th scope="col">状态</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => {
                const availability = nodeAvailability(node, code);
                const isCurrent = currentId === node.id;
                const pending = ['queued', 'testing'].includes(node.status);
                const status = pending
                  ? node.status === 'queued'
                    ? '等待测速'
                    : '测速中'
                  : isCurrent
                    ? node.status === 'connected'
                      ? '当前节点'
                      : '当前节点异常'
                    : availability.label;
                return (
                  <tr
                    key={node.id}
                    className={availability.mismatch ? styles.mismatch : ''}
                    aria-current={isCurrent ? 'true' : undefined}
                  >
                    <td>
                      <Radio
                        name={`${id}-node`}
                        aria-label={`选择 ${node.name}`}
                        checked={isCurrent}
                        disabled={busy || !availability.selectable}
                        onChange={() => {
                          clear();
                          setDialog({ kind: 'switch', node });
                        }}
                      />
                    </td>
                    <th scope="row">
                      <span className={styles.nodeName}>
                        {node.countryCode &&
                          ['sg', 'hk', 'us', 'jp'].includes(
                            node.countryCode.toLowerCase(),
                          ) && (
                            <img
                              src={`/flags/${node.countryCode.toLowerCase()}.svg`}
                              alt=""
                            />
                          )}
                        <span title={node.name}>{node.name}</span>
                      </span>
                    </th>
                    <td>{node.region ?? '待检测'}</td>
                    <td>{node.protocol.toUpperCase()}</td>
                    <td
                      className={
                        node.latency != null && !availability.mismatch
                          ? node.latency < 300
                            ? styles.good
                            : styles.slow
                          : ''
                      }
                    >
                      {node.latency != null
                        ? `${node.latency} ms`
                        : node.status === 'failed'
                          ? '超时'
                          : '—'}
                    </td>
                    <td title={node.error ?? availability.reason}>
                      <span className={styles.nodeStatus}>
                        {pending ? (
                          <LoaderCircle className={styles.spinning} />
                        ) : availability.mismatch ? (
                          <LockKeyhole />
                        ) : (
                          <Circle
                            className={
                              node.status === 'connected'
                                ? styles.available
                                : styles.unavailable
                            }
                            fill="currentColor"
                          />
                        )}
                        {status}
                      </span>
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label={`测速 ${node.name}`}
                          title={`测速 ${node.name}`}
                          disabled={busy}
                          onClick={() => test([node.id])}
                        >
                          <Gauge />
                        </Button>
                        <Button
                          variant="icon"
                          aria-label={`删除 ${node.name}`}
                          title={
                            isCurrent
                              ? '当前节点正在使用，请先切换节点'
                              : `删除 ${node.name}`
                          }
                          disabled={busy || isCurrent}
                          onClick={() => {
                            clear();
                            setDialog({ kind: 'remove', node });
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!nodes.length && (
                <tr>
                  <td colSpan={7} className={styles.empty}>
                    {state.isPending
                      ? '正在读取节点…'
                      : state.isError
                        ? '节点读取失败，请重试'
                        : '尚未添加节点，导入订阅或添加通用代理后开始使用。'}
                    {state.isError && (
                      <Button onClick={() => void state.refetch()}>
                        重新读取
                      </Button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </WorkspacePanel>
      {dialog && (
        <DetailDialog
          title={
            dialog.kind === 'upgrade'
              ? 'Mihomo 内核更新'
              : dialog.kind === 'remove'
                ? '删除节点？'
                : '切换出口节点？'
          }
          onClose={() => setDialog(null)}
          closeLabel="取消"
          locked={switching.isPending || removal.isPending}
        >
          {dialog.kind === 'upgrade' ? (
            <p>
              发现新版本 {release.data?.version}。当前 Mihomo{' '}
              {state.data?.runtime.version} 随 CodeSeam 安装包提供，请通过更新
              CodeSeam 升级内核。当前版本不支持独立热升级。
            </p>
          ) : (
            <>
              <p>
                {dialog.kind === 'remove'
                  ? `将删除「${dialog.node.name}」，此操作无法撤销。`
                  : `将切换到「${dialog.node.name}」，关闭专用浏览器并重新验证出口、时区和浏览器配置。登录数据将保留。`}
              </p>
              {(switching.error || removal.error) && (
                <p role="alert" className={styles.error}>
                  {switching.error?.message ?? removal.error?.message}
                </p>
              )}
              <Button
                variant="primary"
                className={styles.primary}
                disabled={switching.isPending || removal.isPending}
                onClick={() =>
                  dialog.kind === 'switch'
                    ? switching.mutate(dialog.node)
                    : removal.mutate(dialog.node)
                }
              >
                {switching.isPending
                  ? '正在切换并复验…'
                  : removal.isPending
                    ? '正在删除…'
                    : dialog.kind === 'switch'
                      ? '切换并重新检测'
                      : '确认删除'}
              </Button>
            </>
          )}
        </DetailDialog>
      )}
    </div>
  );
}

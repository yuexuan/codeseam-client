import { StatusLabel } from '../../components/ui/StatusLabel';
import { Radio } from '../../components/ui/Radio';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Download,
  Gauge,
  Layers,
  List,
  LoaderCircle,
  Server,
  SlidersHorizontal,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import type { NodeSummary } from '../../bindings/commands';
import type { NodesService, ProxyProtocol } from '../../services/nodes';
import { Button } from '../../components/ui/Button';
import { Surface } from '../../components/ui/Surface';
import styles from './NodesPage.module.css';

function sortNodes(nodes: NodeSummary[], sort: 'default' | 'asc' | 'desc') {
  if (sort === 'default') return [...nodes];
  return [...nodes].sort((a, b) => {
    if (a.latency === null) return b.latency === null ? 0 : 1;
    if (b.latency === null) return -1;
    return sort === 'asc' ? a.latency - b.latency : b.latency - a.latency;
  });
}

export function NodesPage({ service }: { service: NodesService }) {
  const client = useQueryClient();
  const state = useQuery({
    queryKey: ['nodes'],
    queryFn: () => service.read(),
  });
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void service
      .subscribe?.((snapshot) => client.setQueryData(['nodes'], snapshot))
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      stop?.();
    };
  }, [service, client]);
  const [tab, setTab] = useState<'clash' | 'general'>('clash');
  const [links, setLinks] = useState('');
  const [protocol, setProtocol] = useState<ProxyProtocol>('socks5');
  const [server, setServer] = useState('');
  const [port, setPort] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [sort, setSort] = useState<'default' | 'asc' | 'desc'>('default');
  const [testOrder, setTestOrder] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (removeId) dialog.current?.showModal();
  }, [removeId]);
  const update = () => client.invalidateQueries({ queryKey: ['nodes'] });
  const importing = useMutation({
    mutationFn: async () => {
      if (tab === 'clash') return service.importLinks(links.trim());
      if (!server.trim()) throw new Error('请填写服务器地址');
      if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
        throw new Error('请填写 1–65535 之间的端口');
      return service.importProxy({
        protocol,
        server: server.trim(),
        port: Number(port),
        username,
        password,
      });
    },
    onSuccess: async (result) => {
      if (tab === 'clash') setLinks('');
      else {
        setServer('');
        setPort('');
        setUsername('');
        setPassword('');
      }
      setNotice(
        `新增 ${result.added} 个节点，跳过 ${result.duplicates} 个重复节点`,
      );
      await update();
      if (result.added > 0) startTesting((await service.read()).nodes);
    },
  });
  const selection = useMutation({
    mutationFn: (id: string) => service.select(id),
    onSuccess: update,
  });
  const removal = useMutation({
    mutationFn: (id: string) =>
      id === '*all*' ? service.clear() : service.remove(id),
    onSuccess: async () => {
      setRemoveId(null);
      await update();
    },
  });
  const testing = useMutation({
    mutationFn: (ids: string[]) => service.test(ids),
    onSuccess: update,
    onError: update,
  });
  const editing =
    importing.isPending || selection.isPending || removal.isPending;
  const busy =
    importing.isPending ||
    selection.isPending ||
    removal.isPending ||
    testing.isPending;
  const data = state.data;
  const sortedNodes = useMemo(() => {
    const nodes = [...(data?.nodes ?? [])];
    if (testing.isPending) {
      const ranks = new Map(testOrder.map((id, index) => [id, index]));
      return nodes.sort(
        (a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity),
      );
    }
    return sortNodes(nodes, sort);
  }, [data?.nodes, sort, testing.isPending, testOrder]);
  function startTesting(nodes: NodeSummary[]) {
    const ids = sortNodes(nodes, sort).map((node) => node.id);
    setTestOrder(ids);
    testing.mutate(ids);
  }
  const activeId = sortedNodes.find((node) => node.status === 'testing')?.id;
  useEffect(() => {
    if (!testing.isPending || !activeId) return;
    const row = rows.current.get(activeId);
    const list = listRef.current;
    if (!row || !list) return;
    const bounds = row.getBoundingClientRect();
    const viewport = list.getBoundingClientRect();
    if (bounds.top < viewport.top || bounds.bottom > viewport.bottom) {
      list.scrollTop += bounds.top - viewport.top;
    }
  }, [activeId, testing.isPending]);
  const statusText = (node: NodeSummary | undefined) =>
    node?.status === 'testing'
      ? '测试中'
      : node?.status === 'failed'
        ? '超时'
        : '待测试';
  const latencyClass = (node: NodeSummary | undefined) =>
    node?.latency != null
      ? node.latency < 300
        ? styles.good
        : styles.slow
      : node?.status === 'failed'
        ? styles.failed
        : styles.latency;
  const selected = data?.nodes.find((node) => node.id === data.selectedId);
  const error =
    importing.error ??
    selection.error ??
    removal.error ??
    testing.error ??
    state.error;
  const clearMessage = () => {
    if (!importing.isPending) importing.reset();
    if (!selection.isPending) selection.reset();
    if (!removal.isPending) removal.reset();
    if (!testing.isPending) testing.reset();
    setNotice('');
  };
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>节点与代理</h1>
        <p>添加代理节点，选择当前使用的节点。</p>
      </div>
      <div className={styles.layout}>
        <Surface className={styles.nodes}>
          <h2>
            <SlidersHorizontal aria-hidden="true" />
            添加节点
          </h2>
          <div className={styles.tabs} role="tablist" aria-label="添加节点方式">
            <button
              type="button"
              role="tab"
              id="clash-tab"
              aria-controls="clash-panel"
              aria-selected={tab === 'clash'}
              onClick={() => {
                setTab('clash');
                clearMessage();
              }}
            >
              <Layers />
              Clash 导入
            </button>
            <button
              type="button"
              role="tab"
              id="general-tab"
              aria-controls="general-panel"
              aria-selected={tab === 'general'}
              onClick={() => {
                setTab('general');
                clearMessage();
              }}
            >
              <Server />
              通用代理
            </button>
          </div>
          <form
            className={styles.importArea}
            onSubmit={(event) => {
              event.preventDefault();
              clearMessage();
              importing.mutate();
            }}
          >
            {tab === 'clash' ? (
              <div
                className={styles.clashForm}
                role="tabpanel"
                id="clash-panel"
                aria-labelledby="clash-tab"
              >
                <textarea
                  aria-label="订阅链接或节点链接"
                  placeholder="粘贴订阅链接或节点链接（支持 SS / VMess / VLESS / Trojan 等）"
                  value={links}
                  onChange={(event) => setLinks(event.target.value)}
                  disabled={busy}
                  spellCheck={false}
                />
                <Button
                  type="submit"
                  variant="primary"
                  className={styles.importButton}
                  disabled={busy}
                >
                  <Download size={22} />
                  {importing.isPending ? '导入中' : '导入'}
                </Button>
              </div>
            ) : (
              <div
                role="tabpanel"
                id="general-panel"
                aria-labelledby="general-tab"
              >
                <div
                  className={styles.protocols}
                  role="group"
                  aria-label="协议"
                >
                  <span>协议</span>
                  {(['socks5', 'http', 'https'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={value === protocol}
                      disabled={busy}
                      onClick={() => setProtocol(value)}
                    >
                      {value.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div className={styles.proxyForm}>
                  <input
                    aria-label="服务器地址"
                    placeholder="服务器地址"
                    value={server}
                    onChange={(event) => setServer(event.target.value)}
                    disabled={busy}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <input
                    aria-label="端口"
                    placeholder="端口"
                    inputMode="numeric"
                    value={port}
                    onChange={(event) => setPort(event.target.value)}
                    disabled={busy}
                  />
                  <input
                    aria-label="用户名（选填）"
                    placeholder="用户名（选填）"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    disabled={busy}
                    autoComplete="off"
                  />
                  <input
                    aria-label="密码（选填）"
                    placeholder="密码（选填）"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={busy}
                    autoComplete="new-password"
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    className={styles.importButton}
                    disabled={busy}
                  >
                    <Download size={22} />
                    {importing.isPending ? '导入中' : '导入'}
                  </Button>
                </div>
              </div>
            )}
          </form>
          <p
            role={error ? 'alert' : 'status'}
            className={error ? styles.error : styles.notice}
          >
            {error?.message ??
              (testing.isPending
                ? `正在检测 · 已完成 ${data?.nodes.filter((node) => ['connected', 'failed'].includes(node.status)).length ?? 0} / ${data?.nodes.length ?? 0}`
                : notice)}
          </p>
          <div className={styles.listHeader}>
            <h2>
              <List aria-hidden="true" />
              已添加节点 · {data?.nodes.length ?? 0}
            </h2>
            <div className={styles.listActions}>
              <button
                type="button"
                className={styles.iconButton}
                disabled={testing.isPending || !data?.nodes.length}
                aria-label={`排序：${sort === 'default' ? '导入顺序' : sort === 'asc' ? '延迟从低到高' : '延迟从高到低'}`}
                title={`当前${sort === 'default' ? '导入顺序，切换为延迟升序' : sort === 'asc' ? '延迟升序，切换为降序' : '延迟降序，切换为导入顺序'}`}
                onClick={() =>
                  setSort(
                    sort === 'default'
                      ? 'asc'
                      : sort === 'asc'
                        ? 'desc'
                        : 'default',
                  )
                }
              >
                {sort === 'desc' ? (
                  <ArrowUpNarrowWide size={21} />
                ) : (
                  <ArrowDownWideNarrow size={21} />
                )}
              </button>
              <button
                type="button"
                className={styles.iconButton}
                disabled={busy || !data?.nodes.length}
                aria-label="清空所有节点"
                title="清空所有节点"
                onClick={() => setRemoveId('*all*')}
              >
                <Trash2 size={21} />
              </button>
              <Button
                className={styles.testButton}
                disabled={busy || !data?.nodes.length}
                onClick={() => {
                  clearMessage();
                  startTesting(data?.nodes ?? []);
                }}
                aria-label="测速"
              >
                {testing.isPending ? (
                  <LoaderCircle size={21} />
                ) : (
                  <Gauge size={21} />
                )}
                {tab === 'clash' && (testing.isPending ? '测速中' : '测速')}
              </Button>
            </div>
          </div>
          <div
            ref={listRef}
            className={styles.nodeList}
            role="radiogroup"
            aria-label="当前使用的节点"
            tabIndex={0}
          >
            {sortedNodes.map((node) => (
              <div
                className={`${styles.nodeRow} ${data?.selectedId === node.id ? styles.selected : ''}`}
                key={node.id}
                ref={(element) => {
                  if (element) rows.current.set(node.id, element);
                  else rows.current.delete(node.id);
                }}
                data-status={node.status}
              >
                <label className={styles.nodeChoice}>
                  <Radio
                    name="selected-node"
                    checked={data?.selectedId === node.id}
                    disabled={editing}
                    onChange={() => {
                      clearMessage();
                      selection.mutate(node.id);
                    }}
                    aria-label={`选择 ${node.name}`}
                  />
                  <span className={styles.nodeName} title={node.name}>
                    {node.countryCode &&
                      ['sg', 'hk', 'us', 'jp'].includes(
                        node.countryCode.toLowerCase(),
                      ) && (
                        <img
                          className={styles.flag}
                          src={`/flags/${node.countryCode.toLowerCase()}.svg`}
                          alt=""
                        />
                      )}
                    {node.name}
                  </span>
                  <span
                    className={`${styles.region} ${node.status === 'failed' ? styles.failed : ''}`}
                    title={node.error ?? '通过出口 IP 检测的地区'}
                  >
                    {node.region ??
                      (node.status === 'failed'
                        ? '超时'
                        : node.error
                          ? '未知'
                          : statusText(node))}
                  </span>
                  <span
                    className={latencyClass(node)}
                    title={node.error ?? undefined}
                  >
                    {node.latency !== null
                      ? `${node.latency} ms`
                      : statusText(node)}
                  </span>
                </label>
                <button
                  className={styles.deleteButton}
                  type="button"
                  disabled={busy}
                  aria-label={`删除 ${node.name}`}
                  onClick={() => setRemoveId(node.id)}
                >
                  <Trash2 size={22} />
                </button>
              </div>
            ))}
            {!data?.nodes.length && (
              <p className={styles.empty}>
                {state.isPending ? '正在读取节点…' : '尚未添加节点'}
              </p>
            )}
          </div>
        </Surface>
        <div className={styles.side}>
          <Surface className={styles.runtime}>
            <h2>
              <Layers aria-hidden="true" />
              Mihomo
            </h2>
            <dl>
              <div>
                <dt>运行状态</dt>
                <dd>
                  <StatusLabel
                    status={
                      data?.runtime.running
                        ? 'satisfied'
                        : data?.runtime.running === false
                          ? 'optional'
                          : 'unknown'
                    }
                    label={
                      data?.runtime.running
                        ? '运行正常'
                        : data?.runtime.running === false
                          ? '按需启动'
                          : '无法确认'
                    }
                  />
                </dd>
              </div>
              <div>
                <dt>版本</dt>
                <dd>{data?.runtime.version ?? '尚未检测到'}</dd>
              </div>
            </dl>
          </Surface>
          <Surface className={styles.current}>
            <div className={styles.currentHeader}>
              <h2>
                <Wifi aria-hidden="true" />
                当前节点
              </h2>
              <span
                className={
                  selected?.status === 'connected'
                    ? styles.connected
                    : latencyClass(selected)
                }
              >
                {selected?.status === 'testing'
                  ? '测试中'
                  : selected?.status === 'connected'
                    ? '连接正常'
                    : selected?.status === 'failed'
                      ? '超时'
                      : '待测试'}
              </span>
            </div>
            <dl>
              <div>
                <dt>名称</dt>
                <dd>{selected?.name ?? '尚未选择'}</dd>
              </div>
              <div>
                <dt>协议</dt>
                <dd>{selected?.protocol.toUpperCase() ?? '—'}</dd>
              </div>
              <div>
                <dt>地区</dt>
                <dd title={selected?.error ?? undefined}>
                  {selected?.region ??
                    (selected?.status === 'failed'
                      ? '超时'
                      : selected?.error
                        ? '未知'
                        : statusText(selected))}
                </dd>
              </div>
              <div>
                <dt>延迟</dt>
                <dd className={latencyClass(selected)}>
                  {selected?.latency !== null && selected?.latency !== undefined
                    ? `${selected.latency} ms`
                    : statusText(selected)}
                </dd>
              </div>
              <div>
                <dt>出口 IP</dt>
                <dd title={selected?.error ?? undefined}>
                  {selected?.exitIp ??
                    (selected?.status === 'failed'
                      ? '超时'
                      : selected?.error
                        ? '未知'
                        : statusText(selected))}
                </dd>
              </div>
            </dl>
            {selected?.error && (
              <p role="status" className={styles.error}>
                {selected.error}
              </p>
            )}
          </Surface>
        </div>
      </div>
      {removeId && (
        <dialog
          ref={dialog}
          className={styles.dialog}
          aria-labelledby="remove-title"
          onCancel={(event) => {
            event.preventDefault();
            if (!removal.isPending) setRemoveId(null);
          }}
        >
          <button
            type="button"
            className={styles.dialogClose}
            aria-label="取消删除"
            disabled={removal.isPending}
            onClick={() => setRemoveId(null)}
          >
            <X size={20} />
          </button>
          <h2 id="remove-title">
            {removeId === '*all*' ? '清空所有节点？' : '删除节点？'}
          </h2>
          <p>
            {removeId === '*all*'
              ? `将删除全部 ${data?.nodes.length ?? 0} 个节点及当前选择，此操作无法撤销。`
              : data?.nodes.find((node) => node.id === removeId)?.name}
          </p>
          <div>
            <Button
              autoFocus
              disabled={removal.isPending}
              onClick={() => setRemoveId(null)}
            >
              取消
            </Button>
            <Button
              variant="primary"
              disabled={removal.isPending}
              onClick={() => {
                clearMessage();
                removal.mutate(removeId);
              }}
            >
              {removeId === '*all*' ? '清空' : '删除'}
            </Button>
          </div>
        </dialog>
      )}
    </div>
  );
}

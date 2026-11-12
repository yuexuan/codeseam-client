import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CircleCheck,
  CircleHelp,
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
import type { NodesService, ProxyProtocol } from '../../services/nodes';
import { Button } from '../../components/ui/Button';
import { Surface } from '../../components/ui/Surface';
import styles from './NodesPage.module.css';

export function NodesPage({ service }: { service: NodesService }) {
  const client = useQueryClient();
  const state = useQuery({
    queryKey: ['nodes'],
    queryFn: () => service.read(),
  });
  const [tab, setTab] = useState<'clash' | 'general'>('clash');
  const [links, setLinks] = useState('');
  const [protocol, setProtocol] = useState<ProxyProtocol>('socks5');
  const [server, setServer] = useState('');
  const [port, setPort] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
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
    },
  });
  const selection = useMutation({
    mutationFn: (id: string) => service.select(id),
    onSuccess: update,
  });
  const removal = useMutation({
    mutationFn: (id: string) => service.remove(id),
    onSuccess: async () => {
      setRemoveId(null);
      await update();
    },
  });
  const testing = useMutation({
    mutationFn: () => service.test(),
    onSuccess: update,
    onError: update,
  });
  const busy =
    importing.isPending ||
    selection.isPending ||
    removal.isPending ||
    testing.isPending;
  const data = state.data;
  const selected = data?.nodes.find((node) => node.id === data.selectedId);
  const error =
    importing.error ??
    selection.error ??
    removal.error ??
    testing.error ??
    state.error;
  const clearMessage = () => {
    importing.reset();
    selection.reset();
    removal.reset();
    testing.reset();
    setNotice('');
  };
  return (
    <>
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
            {error?.message ?? notice}
          </p>
          <div className={styles.listHeader}>
            <h2>
              <List aria-hidden="true" />
              已添加节点 · {data?.nodes.length ?? 0}
            </h2>
            <Button
              className={styles.testButton}
              disabled={busy || !data?.nodes.length}
              onClick={() => {
                clearMessage();
                testing.mutate();
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
          <div
            className={styles.nodeList}
            role="radiogroup"
            aria-label="当前使用的节点"
            tabIndex={0}
          >
            {data?.nodes.map((node) => (
              <div
                className={`${styles.nodeRow} ${data.selectedId === node.id ? styles.selected : ''}`}
                key={node.id}
              >
                <label className={styles.nodeChoice}>
                  <input
                    type="radio"
                    name="selected-node"
                    checked={data.selectedId === node.id}
                    disabled={busy}
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
                  <span className={styles.region}>
                    {node.region ?? '地区待检测'}
                  </span>
                  <span
                    className={
                      node.latency !== null && node.latency < 150
                        ? styles.good
                        : styles.latency
                    }
                  >
                    {testing.isPending
                      ? '检测中'
                      : node.latency !== null
                        ? `${node.latency} ms`
                        : node.status === 'failed'
                          ? '连接失败'
                          : '待检测'}
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
                <dd
                  className={
                    data?.runtime.running ? styles.good : styles.latency
                  }
                >
                  {data?.runtime.running ? (
                    <CircleCheck size={24} />
                  ) : (
                    <CircleHelp size={24} />
                  )}
                  {data?.runtime.running
                    ? '运行正常'
                    : data?.runtime.running === false
                      ? '按需启动'
                      : '无法确认'}
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
                    : styles.latency
                }
              >
                {testing.isPending
                  ? '检测中'
                  : selected?.status === 'connected'
                    ? '连接正常'
                    : selected?.status === 'failed'
                      ? '连接失败'
                      : '待检测'}
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
                <dd>{selected?.region ?? '待检测'}</dd>
              </div>
              <div>
                <dt>延迟</dt>
                <dd
                  className={
                    selected?.latency !== null &&
                    selected?.latency !== undefined &&
                    selected.latency < 150
                      ? styles.good
                      : ''
                  }
                >
                  {selected?.latency !== null && selected?.latency !== undefined
                    ? `${selected.latency} ms`
                    : '待检测'}
                </dd>
              </div>
              <div>
                <dt>出口 IP</dt>
                <dd>{selected?.exitIp ?? '待检测'}</dd>
              </div>
            </dl>
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
          <h2 id="remove-title">删除节点？</h2>
          <p>{data?.nodes.find((node) => node.id === removeId)?.name}</p>
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
              删除
            </Button>
          </div>
        </dialog>
      )}
    </>
  );
}

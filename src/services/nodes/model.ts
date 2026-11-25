import type { NodeSummary } from '../../bindings/commands';
import type { WorkbenchRecord } from '../workbench';

export function baselineNode(record: WorkbenchRecord, nodes: NodeSummary[]) {
  if (record.runtime?.node) return record.runtime.node;
  const profile = record.baseline.profile;
  const node = nodes.find((node) =>
    profile.nodeId
      ? node.id === profile.nodeId
      : node.name === profile.nodeName &&
        node.exitIp === profile.verification?.exitIp,
  );
  return (
    node && {
      ...node,
      countryCode: record.nodeCountry?.code ?? node.countryCode,
      region: record.nodeCountry?.region ?? node.region,
    }
  );
}

export function hasNewerVersion(
  current: string | null | undefined,
  latest: string | undefined,
) {
  if (!current || !latest) return false;
  const a = current.replace(/^v/, '').split('.').map(Number);
  const b = latest.replace(/^v/, '').split('.').map(Number);
  if (
    a.length !== 3 ||
    b.length !== 3 ||
    [...a, ...b].some((value) => !Number.isFinite(value))
  )
    return false;
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return b[index] > a[index];
  }
  return false;
}

export function nodeAvailability(
  node: NodeSummary,
  countryCode: string | null,
) {
  const mismatch =
    !!countryCode &&
    !!node.countryCode &&
    countryCode.toLowerCase() !== node.countryCode.toLowerCase();
  const connected = node.status === 'connected' && !!node.exitIp;
  return {
    mismatch,
    selectable: connected && !!countryCode && !!node.countryCode && !mismatch,
    label: mismatch
      ? '国家不一致'
      : !countryCode
        ? '当前国家待确认'
        : connected && node.countryCode
          ? '可用'
          : node.status === 'failed'
            ? '连接失败'
            : node.status === 'unknown'
              ? '出口待确认'
              : '待测速',
    reason: mismatch
      ? '仅可选择与当前环境出口国家一致的节点'
      : connected && node.countryCode && countryCode
        ? '节点出口检测通过'
        : '节点需通过真实出口检测后才可切换',
  };
}

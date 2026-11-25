import type { DailyBrowserDetails } from './daily';
import type { BrowserResult } from './index';

export function browserReady(profile?: BrowserResult['profile']): boolean {
  return (
    !!profile &&
    profile.compatibility?.status === 'satisfied' &&
    profile.timezoneStatus === 'satisfied' &&
    !!profile.targetTimezone &&
    profile.verification?.observed?.timezone === profile.targetTimezone &&
    !profile.verificationError &&
    !!profile.baselinePath &&
    profile.verification?.ok === true &&
    [
      profile.proxyStatus,
      profile.parametersStatus,
      profile.shortcutStatus,
      profile.verificationStatus,
      profile.baselineStatus,
    ].every((status) => status === 'satisfied')
  );
}

export function networkChecks(p: BrowserResult['profile'], current: boolean) {
  const v = p.verification;
  const measured =
    current &&
    v?.ok === true &&
    !p.verificationError &&
    p.verificationStatus === 'satisfied' &&
    p.proxyStatus === 'satisfied';
  return [
    {
      id: 'exit',
      title: '代理出口',
      value: measured ? p.nodeName : '当前出口待验证',
      status: measured ? 'satisfied' : 'unknown',
    },
    {
      id: 'dns',
      title: 'DNS / DoH',
      value: v?.network.dns
        ? '已配置 · 实际解析路径待验证'
        : '实际解析路径待验证',
      status: 'unknown',
    },
    {
      id: 'webrtc',
      title: 'WebRTC',
      value: measured ? '无非预期公网候选' : 'ICE / STUN 候选待验证',
      status: measured ? 'satisfied' : 'unknown',
    },
    {
      id: 'ipv6',
      title: 'IPv4 / IPv6',
      value: '双栈实际出口待验证',
      status: 'unknown',
    },
    {
      id: 'quic',
      title: 'QUIC / HTTP/3',
      value: v?.network.quic ? '已禁用 · 实际连接待验证' : '实际连接待验证',
      status: 'unknown',
    },
    {
      id: 'bypass',
      title: '代理绕过',
      value: '后台请求路径待验证',
      status: 'unknown',
    },
  ] satisfies DailyBrowserDetails['checks'];
}

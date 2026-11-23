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

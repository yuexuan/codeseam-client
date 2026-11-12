import type { Report } from '../../bindings/commands';
export function summarize(report: Report) {
  return {
    pending: report.checks.filter((item) => item.status === 'pending').length,
    unknown: report.checks.filter((item) => item.status === 'unknown').length,
    optional: report.checks.filter((item) => item.status === 'optional').length,
    blockers: report.checks.filter((item) => item.blocking),
  };
}

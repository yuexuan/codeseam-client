/** 仅开发模式、且不在 Tauri 壳内（浏览器预览）时启用的后端模拟，用于查看页面效果；不会进入生产包。 */

import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

const MODELS = ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-3-5-haiku-20241022"];
const NAMES = ["a1f3c9d2-77e0", "b82e41aa-19c3", "c0d95e37-4b21", "d417ab60-93fe", "e5a2f018-6c7d", "f93b7d4c-0a15"];

function makeLogs() {
  const logs: Record<string, unknown>[] = [];
  let id = 1;
  const now = Date.now();
  for (let day = 7; day >= 0; day--) {
    const sessionsToday = 2 + ((day * 3) % 4);
    for (let s = 0; s < sessionsToday; s++) {
      const sid = NAMES[(day + s) % NAMES.length] + `-${day}${s}`;
      const base = now - day * 86400000 - (s * 3 + 1) * 3600000;
      const reqs = 4 + ((day + s * 5) % 9);
      for (let r = 0; r < reqs; r++) {
        const model = MODELS[(s + r) % 7 === 0 ? 1 : (s + r) % 11 === 0 ? 2 : 0];
        const dur = 3000 + ((r * 7919) % 20000);
        logs.push({
          id: id++,
          request_id: `req_${id}`,
          session_id: sid,
          model,
          input_tokens: 800 + ((r * 631) % 4000),
          output_tokens: 300 + ((r * 977) % 2500),
          cache_creation_tokens: (r * 1500) % 9000,
          cache_read_tokens: 4000 + ((r * 2113) % 30000),
          total_cost: 0.02 + (r % 5) * 0.011,
          actual_cost: 0.017 + (r % 5) * 0.009,
          duration_ms: dur,
          first_token_ms: 900 + (r % 4) * 300,
          stream: true,
          created_at: new Date(base + r * 4 * 60000).toISOString(),
        });
      }
    }
  }
  return logs;
}

export function installDevMock() {
  const logs = makeLogs();
  const start = new Date(Date.now() - 7 * 86400000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const sum = (f: (l: Record<string, unknown>) => number, rows = logs) => rows.reduce((n, l) => n + f(l), 0);
  const tok = (l: Record<string, unknown>) =>
    (l.input_tokens as number) + (l.output_tokens as number) + (l.cache_creation_tokens as number) + (l.cache_read_tokens as number);

  const trend = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(start.getTime() + i * 86400000);
    const rows = logs.filter((l) => day(new Date(l.created_at as string)) === day(d));
    return {
      date: day(d), requests: rows.length,
      input_tokens: sum((l) => l.input_tokens as number, rows), output_tokens: sum((l) => l.output_tokens as number, rows),
      cache_creation_tokens: sum((l) => l.cache_creation_tokens as number, rows), cache_read_tokens: sum((l) => l.cache_read_tokens as number, rows),
      total_tokens: sum(tok, rows), cost: sum((l) => l.total_cost as number, rows), actual_cost: sum((l) => l.actual_cost as number, rows),
    };
  });
  const models = MODELS.map((m) => {
    const rows = logs.filter((l) => l.model === m);
    return {
      model: m, requests: rows.length,
      input_tokens: sum((l) => l.input_tokens as number, rows), output_tokens: sum((l) => l.output_tokens as number, rows),
      cache_creation_tokens: sum((l) => l.cache_creation_tokens as number, rows), cache_read_tokens: sum((l) => l.cache_read_tokens as number, rows),
      total_tokens: sum(tok, rows), cost: sum((l) => l.total_cost as number, rows), actual_cost: sum((l) => l.actual_cost as number, rows),
    };
  });
  const stats = {
    total_requests: logs.length, total_tokens: sum(tok),
    total_input_tokens: sum((l) => l.input_tokens as number), total_output_tokens: sum((l) => l.output_tokens as number),
    total_cache_tokens: sum((l) => (l.cache_creation_tokens as number) + (l.cache_read_tokens as number)),
    total_cost: sum((l) => l.total_cost as number), total_actual_cost: sum((l) => l.actual_cost as number),
  };
  const status = {
    logged_in: true, server: "http://127.0.0.1:18081",
    services: [{ id: 1, name: "Pro", state: "ACTIVE", expires_at: new Date(Date.now() + 23 * 86400000).toISOString(), quota: 50, quota_used: 6.4 }],
    service_id: 1, proxy_running: true, configured: true, cli: "claude", local_url: "http://127.0.0.1:18899/claude",
    network: { revision: "1", expected_egress: "203.0.113.8" }, requests: 12,
  };

  let prefs = { auto_connect: true, start_minimized: false, close_to_tray: true, work_dir: "" };
  let autostart = false;

  mockWindows("main");
  mockIPC((cmd, args) => {
    const a = (args ?? {}) as { start?: string; end?: string; prefs?: typeof prefs };
    switch (cmd) {
      case "cs_prefs_get":
      case "cs_prefs_set":
        if (a.prefs) prefs = { ...prefs, ...a.prefs };
        return { ...prefs, tray: true, data_dir: "C:\Users\demo\AppData\Local\CodeSeam" };
      case "plugin:autostart|is_enabled":
        return autostart;
      case "plugin:autostart|enable":
      case "plugin:autostart|disable":
        autostart = cmd.endsWith("enable");
        return null;
      case "plugin:app|version":
        return "0.5.0";
      case "cs_resume":
      case "cs_status":
      case "cs_refresh":
        return status;
      case "cs_usage":
        return stats;
      case "cs_usage_report":
        return { start: a.start, end: a.end, stats, trend, models, logs, logs_total: logs.length, truncated: false };
      case "cs_cli_info":
        return { version: "2.0.0", settings_exists: true, env_count: 3 };
      default:
        return null;
    }
  });
}

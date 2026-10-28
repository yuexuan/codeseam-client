/** 全应用共享的数据与动作：状态轮询、命令执行、活动记录、界面偏好。 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { clearActivity, loadActivity, pushActivity } from "./activity";
import { monthRange } from "./format";
import { lastDays } from "./usage";
import {
  applyZoom,
  loadUiPrefs,
  resolveTheme,
  saveUiPrefs,
  watchSystemTheme,
  type UiPrefs,
} from "./uiPrefs";
import type {
  ActivityEvent,
  AppPrefs,
  CliInfo,
  Report,
  Service,
  SettingsTab,
  Status,
  Usage,
  UsageReport,
} from "./types";

const SERVER_KEY = "cs.server";
const PORTAL_KEY = "cs.portal";
const EMAIL_KEY = "cs.email";

export function useCodeSeam() {
  const [status, setStatus] = useState<Status>();
  const [report, setReport] = useState<Report>();
  const [diagMs, setDiagMs] = useState<number>();
  const [usage, setUsage] = useState<Usage>();
  const [usageReport, setUsageReport] = useState<UsageReport>();
  const [usageRange, setUsageRange] = useState<[string, string]>(() => lastDays(7));
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState("");
  const [cliInfo, setCliInfo] = useState<CliInfo>();
  const [activity, setActivity] = useState<ActivityEvent[]>(loadActivity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [server, setServer] = useState(
    () => localStorage.getItem(SERVER_KEY) || "http://127.0.0.1:18081",
  );
  const [portal, setPortal] = useState(
    () => localStorage.getItem(PORTAL_KEY) || "http://127.0.0.1:18081/portal/",
  );
  const [email, setEmail] = useState(() => localStorage.getItem(EMAIL_KEY) || "");
  const [uiPrefs, setUiPrefs] = useState<UiPrefs>(loadUiPrefs);
  const [systemTick, setSystemTick] = useState(0);
  const [prefs, setPrefs] = useState<AppPrefs>();
  const [autostart, setAutostartState] = useState<boolean>();
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("app");
  /** 轮询与命令回调里读取最新界面偏好，避免闭包拿到旧值。 */
  const uiRef = useRef(uiPrefs);
  uiRef.current = uiPrefs;

  /** 上一份状态快照，用于在轮询中发现连接/终端的变化并写入活动记录。 */
  const last = useRef<{ proxy?: boolean; cli_pid?: number }>({});

  const log = useCallback(
    (kind: ActivityEvent["kind"], title: string, detail?: string) =>
      setActivity(pushActivity({ ts: Date.now(), kind, title, detail })),
    [],
  );

  const refresh = useCallback(async () => {
    try {
      const s = await invoke<Status>("cs_status");
      setStatus(s);
      if (last.current.proxy !== undefined && last.current.proxy !== s.proxy_running) {
        log(
          s.proxy_running ? "connect" : "warn",
          s.proxy_running ? "本地代理已启动" : "本地代理已断开",
          s.local_url,
        );
        if (uiRef.current.notifyConn) {
          setNotice(s.proxy_running ? "本地代理已连接" : "本地代理已断开");
        }
      }
      if (last.current.cli_pid !== undefined && last.current.cli_pid !== (s.cli_pid ?? 0)) {
        log(
          "info",
          s.cli_pid ? "Claude Code 终端已启动" : "Claude Code 终端已退出",
          s.cli_pid ? `终端 PID ${s.cli_pid}` : undefined,
        );
      }
      last.current = { proxy: s.proxy_running, cli_pid: s.cli_pid };
    } catch {
      /* 后端不可达时保持空状态，由界面呈现“等待连接服务”。 */
    }
  }, [log]);

  /** 读取 Claude Code CLI 的版本与配置概况（Claude Code 页使用）。 */
  const loadCliInfo = useCallback(async () => {
    try {
      setCliInfo(await invoke<CliInfo>("cs_cli_info"));
    } catch {
      /* 读取失败时页面显示“未提供”，不影响其它功能。 */
    }
  }, []);

  /** 执行后端命令：统一忙态、错误横幅与活动记录。 */
  const run = useCallback(
    async (cmd: string, args?: Record<string, unknown>) => {
      setBusy(true);
      setError("");
      setNotice("");
      const t0 = performance.now();
      try {
        const r = await invoke(cmd, args);
        let done = "操作已完成";
        if (cmd === "cs_diagnose") {
          setReport(r as Report);
          setDiagMs(performance.now() - t0);
          log("check", "环境诊断完成");
          done = "诊断已完成";
        }
        if (cmd === "cs_usage") {
          setUsage(r as Usage);
          log("info", "用量数据已更新", "平台计量已刷新");
          done = "用量数据已更新";
        }
        if (["cs_logout", "cs_disconnect", "cs_activate", "cs_refresh"].includes(cmd))
          setReport(undefined);
        if (cmd === "cs_logout") {
          setUsage(undefined);
          setUsageReport(undefined);
          log("warn", "已退出登录", "受管字段已恢复原配置");
          done = "已退出并恢复配置";
        }
        if (cmd === "cs_login") {
          localStorage.setItem(SERVER_KEY, server);
          localStorage.setItem(EMAIL_KEY, email);
          log("connect", "登录成功", server);
          done = "登录成功";
        }
        if (cmd === "cs_launch") log("connect", "Claude Code 已启动", "通过本地受管代理启动");
        if (cmd === "cs_stop") log("info", "Claude Code 终端已关闭");
        if (cmd === "cs_disconnect") log("warn", "已断开本地代理");
        if (cmd === "cs_activate") log("connect", "服务已激活", "本地代理随激活启动");
        if (cmd === "cs_configure") log("config", "配置已备份并更新", "仅改写受管 API 字段");
        if (cmd === "cs_restore") log("config", "已恢复原配置", "加密备份保留");
        await refresh();
        if (uiRef.current.notifyEvents) setNotice(done);
        return r;
      } catch (e) {
        setError(String(e));
        await refresh().catch(() => {});
      } finally {
        setBusy(false);
      }
    },
    [server, email, log, refresh],
  );

  /** 用量页取区间内的汇总 / 趋势 / 模型 / 请求明细；独立于全局忙态，失败只影响用量页。 */
  const usageSeq = useRef(0);
  const loadUsageReport = useCallback(async (start: string, end: string) => {
    const seq = ++usageSeq.current;
    setUsageRange([start, end]);
    setUsageLoading(true);
    setUsageError("");
    try {
      const r = await invoke<UsageReport>("cs_usage_report", { start, end });
      if (seq === usageSeq.current) setUsageReport(r);
    } catch (e) {
      if (seq === usageSeq.current) setUsageError(String(e));
    } finally {
      if (seq === usageSeq.current) setUsageLoading(false);
    }
  }, []);

  /** 概览页在本月内自动取一次平台计量（登录后执行，避免每次轮询都请求）。 */
  const usageAsked = useRef(false);
  const askUsage = useCallback(() => {
    if (usageAsked.current || !status?.logged_in || busy) return;
    usageAsked.current = true;
    void run("cs_usage", {
      start: monthRange()[0],
      end: monthRange()[1],
    });
  }, [status?.logged_in, busy, run]);

  useEffect(() => {
    // 恢复上次会话并开始轮询；run 会通过 state 闭包取到最新的 server/email。
    void run("cs_resume");
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, []);

  const theme = resolveTheme(uiPrefs.themeMode);

  useEffect(() => {
    if (uiPrefs.themeMode !== "system") return;
    return watchSystemTheme(() => setSystemTick((n) => n + 1));
  }, [uiPrefs.themeMode]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolveTheme(uiPrefs.themeMode);
  }, [uiPrefs.themeMode, systemTick]);

  useEffect(() => {
    document.documentElement.dataset.accent = uiPrefs.accent;
  }, [uiPrefs.accent]);

  useEffect(() => {
    void applyZoom(uiPrefs.zoom).catch(() => {});
  }, [uiPrefs.zoom]);

  /** 修改一项界面偏好并立即保存。 */
  const setUiPref = useCallback(<K extends keyof UiPrefs>(key: K, value: UiPrefs[K]) => {
    setUiPrefs((prev) => {
      const next = { ...prev, [key]: value };
      saveUiPrefs(next);
      return next;
    });
  }, []);

  /** 读取后端行为偏好与开机启动状态（设置页与启动时各取一次）。 */
  const loadPrefs = useCallback(async () => {
    try {
      setPrefs(await invoke<AppPrefs>("cs_prefs_get"));
    } catch {
      /* 读取失败时设置页显示“读取中”，不影响主流程。 */
    }
    try {
      setAutostartState(await invoke<boolean>("plugin:autostart|is_enabled"));
    } catch {
      setAutostartState(undefined);
    }
  }, []);

  /** 保存后端行为偏好；工作目录无效等错误通过全局错误横幅反馈。 */
  const savePrefs = useCallback(
    async (patch: Partial<AppPrefs>) => {
      if (!prefs) return false;
      setError("");
      try {
        setPrefs(await invoke<AppPrefs>("cs_prefs_set", { prefs: { ...prefs, ...patch } }));
        return true;
      } catch (e) {
        setError(String(e));
        return false;
      }
    },
    [prefs],
  );

  const setAutostart = useCallback(async (on: boolean) => {
    setError("");
    try {
      await invoke(on ? "plugin:autostart|enable" : "plugin:autostart|disable");
    } catch (e) {
      setError(`开机自动启动设置失败：${String(e)}`);
    }
    try {
      setAutostartState(await invoke<boolean>("plugin:autostart|is_enabled"));
    } catch {
      setAutostartState(undefined);
    }
  }, []);

  const resetActivity = useCallback(() => setActivity(clearActivity()), []);

  useEffect(() => {
    void loadPrefs();
  }, [loadPrefs]);

  const service: Service | undefined =
    status?.services.find((v) => v.id === status?.service_id) ||
    status?.services[0];

  const toggleTheme = () => setUiPref("themeMode", theme === "light" ? "dark" : "light");

  const saveConnection = () => {
    localStorage.setItem(SERVER_KEY, server);
    localStorage.setItem(PORTAL_KEY, portal);
    setNotice("连接设置已保存");
  };

  return {
    status,
    report,
    diagMs,
    usage,
    usageReport,
    usageRange,
    usageLoading,
    usageError,
    loadUsageReport,
    cliInfo,
    loadCliInfo,
    activity,
    service,
    busy,
    error,
    notice,
    server,
    setServer,
    portal,
    setPortal,
    email,
    setEmail,
    theme,
    toggleTheme,
    uiPrefs,
    setUiPref,
    prefs,
    loadPrefs,
    savePrefs,
    autostart,
    setAutostart,
    settingsTab,
    setSettingsTab,
    resetActivity,
    log,
    run,
    refresh,
    askUsage,
    saveConnection,
  };
}

export type CodeSeam = ReturnType<typeof useCodeSeam>;
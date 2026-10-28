/** 与 src-tauri 后端命令交换的数据结构（字段以后端序列化为准）。 */

export type PageId = "overview" | "diagnostics" | "claude" | "usage" | "settings";

export interface Service {
  id: number;
  name: string;
  state: string;
  expires_at?: string;
  quota?: number;
  quota_used?: number;
}

export interface Status {
  logged_in: boolean;
  server?: string;
  services: Service[];
  service_id?: number;
  proxy_running: boolean;
  configured: boolean;
  cli?: string;
  cli_pid?: number;
  local_url: string;
  network?: { revision: string; expected_egress: string };
  requests?: number;
}

/** Claude Code CLI 的只读信息（后端 cs_cli_info；不含任何密钥值）。 */
export interface CliInfo {
  version?: string | null;
  settings_path?: string | null;
  settings_exists: boolean;
  model?: string | null;
  timeout_ms?: number | null;
  env_count: number;
}

export interface CheckItem {
  id: string;
  label: string;
  status: string;
  detail: string;
  evidence?: string;
  remediation?: string;
  /** 失败时是否阻断受管请求（后端 protected 字段）。 */
  protected?: boolean;
}

export interface Report {
  /** 报告生成时间（Unix 秒）。 */
  generatedAt?: number;
  apiProtection: string;
  nonApiCoverage?: string;
  canStart: boolean;
  checks: CheckItem[];
}

export interface Usage {
  total_requests?: number;
  total_tokens?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_cache_tokens?: number;
  total_actual_cost?: number;
}

/** 单次请求的计量记录（后端 cs_usage_report 已裁剪，不含 IP / UA）。 */
export interface UsageLog {
  id: number;
  request_id: string;
  session_id?: string | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_cost: number;
  actual_cost: number;
  duration_ms?: number | null;
  first_token_ms?: number | null;
  stream: boolean;
  created_at: string;
}

export interface UsageTrendPoint {
  date: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  cost: number;
  actual_cost: number;
}

export interface UsageModelStat {
  model: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  cost: number;
  actual_cost: number;
}

/** 用量页数据：汇总 + 每日趋势 + 模型分布 + 请求明细。 */
export interface UsageReport {
  start: string;
  end: string;
  stats: Usage & { average_duration_ms?: number; total_cost?: number };
  trend: UsageTrendPoint[] | null;
  models: UsageModelStat[] | null;
  logs: UsageLog[];
  logs_total: number;
  /** 明细超过单次拉取上限时为 true，会话/明细只覆盖最近的记录。 */
  truncated: boolean;
}

/** 设置页的二级页面。 */
export type SettingsTab =
  | "app"
  | "proxy"
  | "network"
  | "claude"
  | "models"
  | "workdir"
  | "logs"
  | "shortcuts"
  | "updates"
  | "license"
  | "help";

/** 后端 cs_prefs_get / cs_prefs_set：客户端行为偏好与只读事实。 */
export interface AppPrefs {
  auto_connect: boolean;
  start_minimized: boolean;
  close_to_tray: boolean;
  work_dir: string;
  /** 托盘图标是否真正创建成功；否则“关闭时最小化到托盘”不会生效。 */
  tray: boolean;
  data_dir?: string | null;
}

export type UsageTab = "overview" | "sessions" | "models" | "cost" | "quota" | "export";

/** 近期活动条目（本地生成与保存）。 */
export interface ActivityEvent {
  ts: number;
  kind: "connect" | "check" | "config" | "info" | "warn";
  title: string;
  detail?: string;
}
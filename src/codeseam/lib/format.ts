/** 展示层格式化与文案映射。 */

/** 服务状态的中文文案。 */
export const stateText: Record<string, string> = {
  ACTIVE: "服务正常",
  EXPIRED: "已到期",
  DISABLED: "已停用",
  NOT_PROVISIONED: "待运营开通",
  SUSPENDED: "已暂停",
  QUOTA_EXHAUSTED: "额度不足",
  NOT_STARTED: "尚未开始",
};

/** 诊断结论的中文文案。 */
export const checkText: Record<string, string> = {
  pass: "通过",
  fail: "失败",
  unknown: "待验证",
  warning: "待处理",
  not_applicable: "不适用",
};

export const num = (v?: number) =>
  v == null
    ? "未提供"
    : v.toLocaleString("zh-CN", { maximumFractionDigits: 6 });

export const date = (v?: string) =>
  v ? new Date(v).toLocaleDateString("zh-CN") : "未提供";

export const dateTime = (v?: string) =>
  v ? new Date(v).toLocaleString("zh-CN") : "未提供";

/** 距到期还剩多少天（向上取整，已到期则为 0）。 */
export const daysLeft = (v?: string) => {
  if (!v) return undefined;
  const ms = new Date(v).getTime() - Date.now();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 86400000)) : undefined;
};

const two = (n: number) => String(n).padStart(2, "0");

/** 活动时间标签：今天显示时分，更早显示月日。 */
export const activityTime = (ts: number) => {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hm = `${two(d.getHours())}:${two(d.getMinutes())}`;
  return sameDay ? `今天 ${hm}` : `${two(d.getMonth() + 1)}-${two(d.getDate())} ${hm}`;
};

const day = (d: Date) =>
  `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

export const today = () => day(new Date());

/** 完整时间：YYYY-MM-DD HH:mm:ss（诊断报告时间戳）。 */
export const fullTime = (ms: number) => {
  const d = new Date(ms);
  return `${day(d)} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};

/** 本月 1 号至今的区间，用于概览页自动拉取平台计量。 */
export const monthRange = () => {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), 1);
  return [day(start), day(end)];
};
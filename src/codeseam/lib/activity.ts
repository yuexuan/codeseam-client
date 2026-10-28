/** 近期活动：客户端可观察事件的环形记录，本地持久化，只保留最近 200 条。 */

import type { ActivityEvent } from "./types";

const KEY = "cs.activity";
const LIMIT = 200;

function parse(raw: string | null): ActivityEvent[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? (list as ActivityEvent[]) : [];
  } catch {
    return [];
  }
}

export function loadActivity(): ActivityEvent[] {
  return parse(localStorage.getItem(KEY));
}

/** 记录一条活动并返回最新列表。 */
export function pushActivity(ev: ActivityEvent): ActivityEvent[] {
  const list = [{ ...ev, ts: ev.ts ?? Date.now() }, ...parse(localStorage.getItem(KEY))].slice(
    0,
    LIMIT,
  );
  localStorage.setItem(KEY, JSON.stringify(list));
  return list;
}

/** 清空全部活动记录。 */
export function clearActivity(): ActivityEvent[] {
  localStorage.removeItem(KEY);
  return [];
}

import type { ReactNode } from "react";

type Tone = "neutral" | "gold" | "green" | "amber" | "red" | "pro";

interface Props {
  tone?: Tone;
  children: ReactNode;
}

/** 小徽章：状态、计划、时间范围等。pro 为铜金渐变计划徽章。 */
export function Badge({ tone = "neutral", children }: Props) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
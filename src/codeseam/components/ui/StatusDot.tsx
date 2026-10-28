type Tone = "green" | "amber" | "gold" | "gray";

const cls: Record<Tone, string> = {
  green: "dot dot--green",
  amber: "dot dot--amber",
  gold: "dot dot--gold",
  gray: "dot",
};

/** 状态圆点：连接状态、时间线节点。 */
export function StatusDot({ tone = "gray" }: { tone?: Tone }) {
  return <span className={cls[tone]} aria-hidden="true" />;
}
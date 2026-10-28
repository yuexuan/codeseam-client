import { CalendarDays } from "lucide-react";
import { lastDays } from "../../lib/usage";
import { today } from "../../lib/format";

const monthStart = (): [string, string] => [today().slice(0, 8) + "01", today()];

const PRESETS: { label: string; range: () => [string, string] }[] = [
  { label: "今天", range: () => [today(), today()] },
  { label: "近 7 天", range: () => lastDays(7) },
  { label: "近 30 天", range: () => lastDays(30) },
  { label: "本月", range: monthStart },
];

/** 日期区间选择：快捷区间 + 起止日期；区间变化即触发查询。 */
export function DateRange({
  value,
  disabled,
  onChange,
}: {
  value: [string, string];
  disabled?: boolean;
  onChange: (start: string, end: string) => void;
}) {
  const [start, end] = value;
  const set = (s: string, e: string) => {
    if (s && e && s <= e) onChange(s, e);
  };
  return (
    <div className="range">
      <div className="range-presets" role="group" aria-label="快捷区间">
        {PRESETS.map((p) => {
          const [s, e] = p.range();
          return (
            <button
              key={p.label}
              className={s === start && e === end ? "on" : ""}
              disabled={disabled}
              onClick={() => onChange(s, e)}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="range-pill">
        <CalendarDays size={14} />
        <input
          type="date"
          aria-label="开始日期"
          value={start}
          max={end}
          disabled={disabled}
          onChange={(e) => set(e.target.value, end)}
        />
        <span>—</span>
        <input
          type="date"
          aria-label="结束日期"
          value={end}
          min={start}
          max={today()}
          disabled={disabled}
          onChange={(e) => set(start, e.target.value)}
        />
      </div>
    </div>
  );
}

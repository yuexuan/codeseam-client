import { useId, useState } from "react";
import { CircleHelp } from "lucide-react";

/** 悬停、聚焦和点击均可访问；按 Escape 关闭后，需再次进入才会显示。 */
export function HelpTip({ label, children }: { label: string; children: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return <span className="help-tip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
    <button type="button" aria-label={`${label}帮助`} aria-expanded={open} aria-describedby={open ? id : undefined}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen(true)}
      onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}><CircleHelp size={14} /></button>
    {open && <span id={id} role="tooltip">{children}</span>}
  </span>;
}

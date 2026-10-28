import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "default" | "ghost";
type Size = "md" | "sm";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

/** 通用按钮：primary 为铜金渐变主按钮，default 为白底描边按钮。 */
export function Button({
  variant = "default",
  size = "md",
  icon,
  className = "",
  children,
  ...rest
}: Props) {
  const cls = ["btn", variant !== "default" && `btn--${variant}`, size === "sm" && "btn--sm", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} {...rest}>
      {icon}
      {children}
    </button>
  );
}
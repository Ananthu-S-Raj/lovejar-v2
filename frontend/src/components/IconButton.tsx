import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  label: string; // accessible name + tooltip
  onClick?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  size?: "sm" | "md";
};

// Compact icon-only button with an accessible name and a CSS tooltip on desktop.
// Always pair with a label — never rely on the icon alone (accessibility).
export default function IconButton({ children, label, onClick, destructive, disabled, size = "md" }: Props) {
  return (
    <button
      type="button"
      className={
        "icon-btn" +
        (destructive ? " destructive" : "") +
        (size === "sm" ? " sm" : "") +
        (disabled ? " disabled" : "")
      }
      aria-label={label}
      data-tooltip={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

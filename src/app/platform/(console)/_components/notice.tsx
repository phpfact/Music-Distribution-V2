import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { FOCUS_RING } from "./styles";

type NoticeVariant = "success" | "error" | "warning" | "info";

type NoticeProps = {
  variant: NoticeVariant;
  title?: ReactNode;
  children?: ReactNode;
  /** Shows a close button; only from a client component. */
  onDismiss?: () => void;
};

const VARIANTS: Record<NoticeVariant, { icon: IconName; srLabel: string; className: string }> = {
  success: {
    icon: "circle-check",
    srLabel: "Success:",
    className: "border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  },
  error: {
    icon: "circle-x",
    srLabel: "Error:",
    className: "border-red-600/30 bg-red-500/10 text-red-700 dark:text-red-400",
  },
  warning: {
    icon: "alert-triangle",
    srLabel: "Warning:",
    className: "border-amber-600/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  },
  info: {
    icon: "info",
    srLabel: "Note:",
    className: "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  },
};

/**
 * A message box for the result of an action or a state worth knowing. Errors
 * interrupt (`alert`); everything else is announced politely (`status`).
 */
export function Notice({ variant, title, children, onDismiss }: NoticeProps) {
  const { icon, srLabel, className } = VARIANTS[variant];

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={`flex gap-3 rounded-lg border px-4 py-3 text-sm ${className}`}
    >
      <Icon name={icon} className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 break-words">
        {/* The icon is decorative: the kind of message is also said in words. */}
        <span className="sr-only">{srLabel} </span>
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? "mt-1" : undefined}>{children}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className={`-my-1 -mr-2 grid size-7 shrink-0 place-items-center rounded-md opacity-80 transition-opacity hover:opacity-100 ${FOCUS_RING}`}
        >
          <Icon name="x" className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

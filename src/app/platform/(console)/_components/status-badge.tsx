import type { ReactNode } from "react";
import { TENANT_STATUS_LABELS, type TenantStatus } from "../tenants/labels";

export type BadgeTone = "success" | "warning" | "danger" | "neutral" | "accent";

// Every badge has a border (transparent for the tinted ones) so the outlined
// "Setup failed" is exactly as tall as the rest.
const PILL = "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const TONES: Record<BadgeTone, string> = {
  success: "border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-transparent bg-amber-500/10 text-amber-800 dark:text-amber-300",
  danger: "border-transparent bg-red-500/10 text-red-700 dark:text-red-400",
  neutral: "border-transparent bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  accent: "border-transparent bg-accent-soft text-accent",
};

// A failed setup is outlined, a suspension solid: both red, told apart by
// shape as well as by their words.
const DANGER_OUTLINED = "border-red-600/50 bg-transparent text-red-700 dark:border-red-500/50 dark:text-red-400";

const STATUS_CLASSES: Record<TenantStatus, string> = {
  pending: TONES.warning,
  provisioning: TONES.warning,
  active: TONES.success,
  failed: DANGER_OUTLINED,
  suspended: TONES.danger,
  deprovisioning: TONES.neutral,
};

type ToneBadgeProps = {
  tone: BadgeTone;
  children: ReactNode;
};

/** A small coloured label for any other state (database ready, domain pending…). */
export function ToneBadge({ tone, children }: ToneBadgeProps) {
  return <span className={`${PILL} ${TONES[tone]}`}>{children}</span>;
}

type StatusBadgeProps = {
  status: TenantStatus;
};

/** A tenant's status, in words and colour. */
export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`${PILL} ${STATUS_CLASSES[status]}`}>
      {status === "provisioning" ? (
        // Shows that work is under way; it holds still when motion is reduced.
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
      ) : null}
      {TENANT_STATUS_LABELS[status]}
    </span>
  );
}

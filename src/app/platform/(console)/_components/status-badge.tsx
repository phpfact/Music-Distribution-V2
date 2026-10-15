import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { TENANT_STATUS_LABELS, type TenantStatus } from "../tenants/labels";
export type BadgeTone = "success" | "warning" | "danger" | "neutral" | "accent";
const VARIANTS = {
  success: "success",
  warning: "warning",
  danger: "destructive-soft",
  neutral: "secondary",
  accent: "outline",
} as const;
const STATUS_TONES: Record<TenantStatus, BadgeTone> = {
  pending: "warning",
  provisioning: "warning",
  active: "success",
  failed: "danger",
  suspended: "danger",
  deprovisioning: "neutral",
};

/**
 * Render a shared Badge for auxiliary tenant state.
 * Input: semantic tone and label. Output: theme-aware status label.
 * Use case: database, connection and domain states use one component system.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function ToneBadge({
  tone,
  children,
}: {
  tone: BadgeTone;
  children: ReactNode;
}) {
  return (
    <Badge
      variant={VARIANTS[tone]}
      className={
        tone === "accent"
          ? "border-transparent bg-accent-soft text-primary"
          : undefined
      }
    >
      {children}
    </Badge>
  );
}

/**
 * Render the tenant lifecycle label without changing its business state.
 * Input: persisted tenant status. Output: a textual, semantic shadcn Badge.
 * Use case: directory and dashboard preserve status distinctions and busy feedback.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function StatusBadge({ status }: { status: TenantStatus }) {
  return (
    <Badge
      variant={status === "failed" ? "outline" : VARIANTS[STATUS_TONES[status]]}
      className={
        status === "failed"
          ? "border-destructive/50 text-destructive"
          : undefined
      }
    >
      {status === "provisioning" ? (
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-current motion-safe:animate-pulse"
        />
      ) : null}
      {TENANT_STATUS_LABELS[status]}
    </Badge>
  );
}

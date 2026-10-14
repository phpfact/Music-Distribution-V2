import type { DatabaseState } from "@/lib/tenants/service";
import { ToneBadge, type BadgeTone } from "../../_components/status-badge";
import { DOMAIN_STATUS_LABELS, type DomainStatus } from "../labels";

const DATABASE_STATES: Record<DatabaseState, { label: string; tone: BadgeTone }> = {
  ready: { label: "Ready", tone: "success" },
  provisioning: { label: "Provisioning", tone: "warning" },
  pending: { label: "Pending", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
};

const DOMAIN_TONES: Record<DomainStatus, BadgeTone> = {
  pending: "warning",
  active: "success",
  failed: "danger",
};

/** Whether a tenant's database is ready, in words and colour. */
export function DatabaseStateBadge({ state }: { state: DatabaseState }) {
  const { label, tone } = DATABASE_STATES[state];
  return <ToneBadge tone={tone}>{label}</ToneBadge>;
}

/** A domain's verification state, in words and colour; `compact` says just "Pending" for a table cell. */
export function DomainStatusBadge({ status, compact = false }: { status: DomainStatus; compact?: boolean }) {
  const label = compact && status === "pending" ? "Pending" : DOMAIN_STATUS_LABELS[status];
  return <ToneBadge tone={DOMAIN_TONES[status]}>{label}</ToneBadge>;
}

/** The "Existing" tag of a tenant that brought its own database. */
export function ExistingDatabaseTag() {
  return <ToneBadge tone="neutral">Existing</ToneBadge>;
}

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

/**
 * Description: Show whether a tenant's database is ready, in words and colour.
 * Input: The database state.
 * Output: A tone badge: Ready, Provisioning, Pending or Failed.
 * Use case: The directory's Database column.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function DatabaseStateBadge({ state }: { state: DatabaseState }) {
  const { label, tone } = DATABASE_STATES[state];
  return <ToneBadge tone={tone}>{label}</ToneBadge>;
}

/**
 * Description: Show a domain's verification state, in words and colour.
 * Input: The domain status and whether to use the compact wording.
 * Output: A tone badge (compact says just "Pending" for a table cell).
 * Use case: Directory and details page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function DomainStatusBadge({ status, compact = false }: { status: DomainStatus; compact?: boolean }) {
  const label = compact && status === "pending" ? "Pending" : DOMAIN_STATUS_LABELS[status];
  return <ToneBadge tone={DOMAIN_TONES[status]}>{label}</ToneBadge>;
}

/**
 * Description: Mark a tenant that brought its own database.
 * Input: None.
 * Output: A neutral "Existing" badge.
 * Use case: The directory's Database column.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function ExistingDatabaseTag() {
  return <ToneBadge tone="neutral">Existing</ToneBadge>;
}

/**
 * Decisions and wording of the tenant details page that do not need React:
 * when setup is shown and polled, and how history and suspension read.
 * Pure, so the tests can check them directly.
 */
import type { TenantHistoryAction, TenantDetails } from "@/lib/tenants/service";
import { formatDateTime } from "./format";
import type { TenantStatus } from "./labels";

/**
 * Description: Tell whether the tenant's setup is under way.
 * Input: The tenant status.
 * Output: True for pending and provisioning.
 * Use case: The details page polls for progress (AutoRefresh) while this holds.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function isSetupInProgress(status: TenantStatus): boolean {
  return status === "pending" || status === "provisioning";
}

/**
 * Description: Decide whether the details page shows the setup card.
 * Input: The tenant status and whether setup can be retried.
 * Output: True until setup has succeeded, and whenever it can be retried.
 * Use case: The Setup Progress section (and its secondary-menu item).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function showsSetupCard(status: TenantStatus, canRetry: boolean): boolean {
  return isSetupInProgress(status) || status === "failed" || canRetry;
}

export const HISTORY_LABELS: Readonly<Record<TenantHistoryAction, string>> = {
  "tenant.created": "Tenant created",
  "tenant.provisioned": "Setup completed",
  "tenant.provisioning_failed": "Setup failed",
  "tenant.suspended": "Suspended",
  "tenant.reactivated": "Reactivated",
};

export const DATABASE_MODE_LABELS: Readonly<Record<TenantDetails["database"]["mode"], string>> = {
  provisioned: "New database, created by the platform",
  existing: "Existing database",
};

export const SCHEMA_STATUS_LABELS: Readonly<
  Record<TenantDetails["database"]["schemaStatus"], string>
> = {
  pending: "Not installed yet",
  current: "Up to date",
  failed: "Failed",
};

/**
 * Description: Word the start of the suspension notice.
 * Input: The tenant's suspension (time, actor, reason).
 * Output: "Suspended" or "Suspended on 14 Oct 2026, 07:03 UTC". The actor and the
 *   reason are rendered by the page, because a platform owner's username is
 *   masked behind an eye button there.
 * Use case: The suspension notice of the details page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function suspensionLead(suspension: NonNullable<TenantDetails["suspension"]>): string {
  return suspension.at ? `Suspended on ${formatDateTime(suspension.at)}` : "Suspended";
}

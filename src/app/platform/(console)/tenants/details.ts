/**
 * Decisions and wording of the tenant details page that do not need React:
 * when setup is shown and polled, and how history and suspension read.
 * Pure, so the tests can check them directly.
 */
import type { TenantHistoryAction, TenantDetails } from "@/lib/tenants/service";
import { formatDateTime } from "./format";
import type { TenantStatus } from "./labels";

/** Setup is under way: the page polls for progress while this holds. */
export function isSetupInProgress(status: TenantStatus): boolean {
  return status === "pending" || status === "provisioning";
}

/** The setup card is shown until setup has succeeded, and whenever it can be retried. */
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
 * "Suspended on 14 Oct 2026, 07:03 UTC by owner: <reason>", leaving out
 * whatever is unknown.
 */
export function suspensionSentence(suspension: NonNullable<TenantDetails["suspension"]>): string {
  let sentence = "Suspended";
  if (suspension.at) sentence += ` on ${formatDateTime(suspension.at)}`;
  if (suspension.by) sentence += ` by ${suspension.by}`;
  return suspension.reason ? `${sentence}: ${suspension.reason}` : `${sentence}.`;
}

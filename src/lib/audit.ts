import "server-only";
import { isIP } from "node:net";
import type { AuditActorType } from "@/generated/prisma/control/client";
import type { ControlDb } from "./db/control";

/** Every action written to `audit_events`. Add new ones here, never ad hoc strings. */
export type AuditAction =
  | "tenant.created"
  | "tenant.provisioning_started"
  | "tenant.provisioning_retried"
  | "tenant.provisioned"
  | "tenant.provisioning_failed"
  | "tenant.suspended"
  | "tenant.reactivated"
  | "tenant.updated"
  | "tenant.admin_password_reset"
  | "tenant.database_password_rotated"
  | "tenant.database_password_updated"
  | "tenant.domain_verified"
  | "appearance.applied"
  | "appearance.reset"
  // Tenant portal (.vibe/memory/customer-registration.md, workspace-appearance.md)
  | "customer_registration.submitted"
  | "customer_registration.approved"
  | "customer_registration.rejected"
  | "customer_registration.review_requested"
  | "customer_account.suspended"
  | "customer_account.reactivated"
  | "workspace_appearance.applied"
  | "workspace_appearance.reset";

type AuditMetadataValue = string | number | boolean | null | string[];

/**
 * Extra detail for an audit row: flat JSON only. NEVER credentials, password
 * hashes, secret references, tokens, connection strings or private media URLs
 * (e.g. for an update, the changed field *names*, not their values).
 */
export type AuditMetadata = Record<string, AuditMetadataValue>;

export type AuditEntry = {
  actorType: AuditActorType;
  /** E.g. the platform owner's id; null for the system. */
  actorId: string | null;
  tenantId: string | null;
  action: AuditAction;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: AuditMetadata;
  /** The client address; anything that is not an IP address is stored as NULL. */
  ipAddress?: string | null;
};

/** The application's client or an interactive transaction on it. */
type AuditDb = Pick<ControlDb, "auditEvent">;

/**
 * Description: Keep only a real IP address for the `inet` audit column.
 * Input: A client address (may be the limiter's "unknown" bucket).
 * Output: The address, or null for anything that is not an IP address (which would
 *   make the insert fail and lose the event).
 * Use case: recordAudit.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function inetOrNull(value: string | null | undefined): string | null {
  return value && isIP(value) !== 0 ? value : null;
}

/**
 * Description: Write one audit event.
 * Input: The database client or the transaction making the change, and the entry
 *   (actor, tenant, action, target, metadata without secrets, client address).
 * Output: Nothing. Pass the transaction that makes the change, so the event is
 *   recorded if and only if the change is.
 * Use case: Every tenant and appearance change.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function recordAudit(db: AuditDb, entry: AuditEntry): Promise<void> {
  await db.auditEvent.create({
    data: {
      actorType: entry.actorType,
      actorId: entry.actorId,
      tenantId: entry.tenantId,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      ...(entry.metadata ? { metadata: entry.metadata } : {}),
      ipAddress: inetOrNull(entry.ipAddress),
    },
  });
}

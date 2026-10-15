import "server-only";
/**
 * Pieces shared by the tenant use cases (docs/tenant-management.md §8).
 *
 * The services take plain values and return plain, serializable results, so
 * they can be tested without Next.js; the Server Actions are thin wrappers.
 */
import type { AuditEntry } from "@/lib/audit";
import type { ProvisioningActor } from "@/lib/provisioning";

/** The platform owner a service call acts for. Comes from the session, never from the request body. */
export type TenantActor = { ownerId: string; ipAddress: string | null };

/** A refusal the browser may show as is. */
export type ServiceFailure<R extends string> = { ok: false; reason: R; message: string };

// Ids arrive from URLs and form fields: anything else must not reach a uuid
// column. The one shared check lives in src/lib/uuid.ts.
export { isUuid } from "@/lib/uuid";

/**
 * Description: Build the audit fields of an owner-initiated change (§8.7).
 * Input: The acting owner (from the session).
 * Output: actorType super_admin, the owner id and the client address.
 * Use case: Every tenant service that records an audit event.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function ownerAudit(actor: TenantActor): Pick<AuditEntry, "actorType" | "actorId" | "ipAddress"> {
  return { actorType: "super_admin", actorId: actor.ownerId, ipAddress: actor.ipAddress };
}

/**
 * Description: Describe the acting owner for the provisioning runner.
 * Input: The acting owner (from the session).
 * Output: The runner's actor (super_admin, owner id, client address).
 * Use case: Starting or retrying a tenant's setup.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function provisioningActor(actor: TenantActor): ProvisioningActor {
  return { type: "super_admin", ownerId: actor.ownerId, ipAddress: actor.ipAddress };
}

export const UNAVAILABLE_MESSAGE = "This action is temporarily unavailable. Try again shortly.";

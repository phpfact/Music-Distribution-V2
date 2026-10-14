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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids arrive from URLs and form fields: anything else must not reach a uuid column. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** The audit fields every owner-initiated change carries (§8.7). */
export function ownerAudit(actor: TenantActor): Pick<AuditEntry, "actorType" | "actorId" | "ipAddress"> {
  return { actorType: "super_admin", actorId: actor.ownerId, ipAddress: actor.ipAddress };
}

export function provisioningActor(actor: TenantActor): ProvisioningActor {
  return { type: "super_admin", ownerId: actor.ownerId, ipAddress: actor.ipAddress };
}

export const UNAVAILABLE_MESSAGE = "This action is temporarily unavailable. Try again shortly.";

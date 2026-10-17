import "server-only";
/**
 * Helpers shared by the role and sub-user services
 * (.vibe/memory/role-privilege-management.md, "Technical Notes" → "Services"):
 * privilege checks, the audit writer (after commit), escalation audit,
 * refusals with friendly messages, pagination and unique-violation detection.
 */
import { recordAudit, type AuditAction, type AuditMetadata } from "@/lib/audit";
import { getControlDb } from "@/lib/db/control";
import { describeError } from "@/lib/platform-auth/session";
import { actorTenantId, AUDIT_ACTOR_TYPES, type AuthzActor } from "./actor";
import { isCoreModule, permissionsOfDomain, type AuthzDomain } from "./catalog";
import {
  MANAGEMENT_PAGE_SIZE,
  MANAGEMENT_PRIVILEGES,
  type ManagementOperation,
  type ManagementProblem,
} from "./management-model";
import type { PolicyActor } from "./policy";
import { FORBIDDEN_MESSAGE, NO_ACTIVE_ROLE_MESSAGE } from "./resolver";

/** Shown when the database could not complete a change (details are in the log). */
export const UNAVAILABLE_MESSAGE = "The change could not be saved. Please try again.";
/** Shown when a list or detail could not be loaded (details are in the log). */
export const LOAD_FAILED_MESSAGE = "This information could not be loaded. Please try again.";

// Prisma's error code for a violated unique constraint.
const UNIQUE_VIOLATION = "P2002";

/**
 * A refusal produced inside a transaction: the friendly result plus, for a
 * blocked escalation attempt, what to audit after the transaction ends.
 */
export type Refusal<FieldErrors> = {
  ok: false;
  reason: ManagementProblem;
  error: string;
  fieldErrors?: FieldErrors;
  /** Present for scope / ceiling / master violations: audited as authz.escalation_blocked. */
  escalation?: { attempt: string; targetType: string; targetId: string | null; keys?: string[] };
};

/**
 * Description: Tell whether the actor holds the privilege of one management operation.
 * Input: The actor (snapshot or reloaded) and the operation (e.g. "rolesEdit").
 * Output: True when the domain's catalog key for that operation is in the actor's effective set.
 * Use case: Every service function (defence in depth; the Server Action also checks).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function holdsPrivilege(actor: Pick<PolicyActor, "domain" | "permissions">, operation: ManagementOperation): boolean {
  const key: string = MANAGEMENT_PRIVILEGES[actor.domain][operation];
  return actor.permissions.includes(key);
}

/**
 * Description: Tell whether the actor holds at least one of several operations.
 * Input: The actor and the operations.
 * Output: True when any of them is held.
 * Use case: listAssignableRoles (needed by role delete and sub-user forms).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function holdsAnyPrivilege(
  actor: Pick<PolicyActor, "domain" | "permissions">,
  operations: readonly ManagementOperation[],
): boolean {
  return operations.some((operation) => holdsPrivilege(actor, operation));
}

/**
 * Description: Build the refusal for a missing privilege.
 * Input: The actor (an actor without any privilege gets the "no active role" text).
 * Output: A forbidden refusal with a friendly message.
 * Use case: Every service function.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function forbidden(actor: Pick<PolicyActor, "permissions">): { ok: false; reason: "forbidden"; error: string } {
  return { ok: false, reason: "forbidden", error: actor.permissions.length === 0 ? NO_ACTIVE_ROLE_MESSAGE : FORBIDDEN_MESSAGE };
}

/**
 * Description: Write one management audit event after the change committed.
 * Input: The actor and the event (action, target, metadata without secrets).
 * Output: Nothing. The tenant database and the control-plane audit log cannot
 *   share a transaction, so every event is written right after the commit; a
 *   failure is logged and never undoes the change.
 * Use case: Every successful mutation; escalation attempts.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function auditAfterCommit(
  actor: AuthzActor,
  entry: { action: AuditAction; targetType: string; targetId: string | null; metadata?: AuditMetadata },
): Promise<void> {
  try {
    await recordAudit(getControlDb(), {
      actorType: AUDIT_ACTOR_TYPES[actor.domain],
      actorId: actor.userId,
      tenantId: actorTenantId(actor),
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata,
      ipAddress: actor.ipAddress,
    });
  } catch (error) {
    console.error(`[rbac] audit "${entry.action}" by ${actor.domain} user ${actor.userId} not written: ${describeError(error)}`);
  }
}

/**
 * Description: Finish a refusal: audit a blocked escalation, return the friendly result.
 * Input: The actor and the refusal from inside a transaction.
 * Output: The refusal without its audit details (safe to return to the client).
 * Use case: Every mutation of the role and sub-user services.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function settleRefusal<FieldErrors>(
  actor: AuthzActor,
  refusal: Refusal<FieldErrors>,
): Promise<{ ok: false; reason: ManagementProblem; error: string; fieldErrors?: FieldErrors }> {
  // Step 1: a blocked escalation attempt is logged and audited (keys only, never secrets).
  if (refusal.escalation) {
    const { attempt, targetType, targetId, keys } = refusal.escalation;
    console.warn(
      `[rbac] escalation blocked: ${actor.domain} user ${actor.userId}${actorTenantId(actor) ? ` (tenant ${actorTenantId(actor)})` : ""}` +
        ` ${attempt} on ${targetType} ${targetId ?? "-"}`,
    );
    await auditAfterCommit(actor, {
      action: "authz.escalation_blocked",
      targetType,
      targetId,
      metadata: { attempt, ...(keys ? { keys } : {}) },
    });
  }
  // Step 2: only the friendly parts leave the service.
  const result: { ok: false; reason: ManagementProblem; error: string; fieldErrors?: FieldErrors } = {
    ok: false,
    reason: refusal.reason,
    error: refusal.error,
  };
  if (refusal.fieldErrors) result.fieldErrors = refusal.fieldErrors;
  return result;
}

/**
 * Description: Tell whether an error is a violated unique constraint.
 * Input: Any thrown value.
 * Output: True for Prisma's P2002 (a race the duplicate check could not prevent).
 * Use case: Role name and username/email races.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === UNIQUE_VIOLATION;
}

/**
 * Description: Work out the page window of a list.
 * Input: The total number of matching rows and the requested page.
 * Output: The page (a page beyond the end shows the last page), the page count,
 *   the rows to skip and the page size (20).
 * Use case: Every paged list of the services.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function pageWindow(total: number, requestedPage: number): { page: number; pageCount: number; skip: number; take: number } {
  const pageCount = Math.max(1, Math.ceil(total / MANAGEMENT_PAGE_SIZE));
  const page      = Math.min(Math.max(1, requestedPage), pageCount);
  return { page, pageCount, skip: (page - 1) * MANAGEMENT_PAGE_SIZE, take: MANAGEMENT_PAGE_SIZE };
}

/**
 * Description: Count the privileges a master role grants in one domain right now.
 * Input: The domain and the disabled modules.
 * Output: The number of the domain's privileges outside disabled (non-core) modules.
 * Use case: The "All (N)" figure of master roles.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function activePrivilegeCount(domain: AuthzDomain, disabledModules: readonly string[]): number {
  return permissionsOfDomain(domain).filter(
    (permission) => !(disabledModules.includes(permission.module) && !isCoreModule(permission.module)),
  ).length;
}

/**
 * Description: Tell whether an error is a deadlock / serialization conflict.
 * Input: Any thrown value.
 * Output: True for Prisma's P2034 or a driver error carrying SQLSTATE 40P01 / 40001.
 * Use case: logFailure (the user gets the friendly "try again" message either way).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function isLockConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "P2034") return true;
  // With the pg driver adapter the SQLSTATE sits in meta or in the message.
  const detail = `${JSON.stringify((error as { meta?: unknown }).meta ?? {})} ${String((error as Error).message)}`;
  return detail.includes("40P01") || detail.includes("40001") || detail.toLowerCase().includes("deadlock");
}

/**
 * Description: Log an unexpected failure of a service function.
 * Input: The actor, what was attempted and the error.
 * Output: Nothing (one `[rbac]` log line with the technical detail; lock
 *   conflicts are logged as a warning, they are retryable).
 * Use case: Every catch block of the services (users only see a friendly message).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function logFailure(actor: AuthzActor, attempt: string, error: unknown): void {
  const tenant = actorTenantId(actor);
  // Two transactions waiting on each other's row locks: PostgreSQL aborted one
  // (40P01). Nothing was written; the user sees "please try again".
  if (isLockConflict(error)) {
    console.warn(`[rbac] ${attempt} hit a lock conflict (deadlock) for ${actor.domain} user ${actor.userId}${tenant ? ` (tenant ${tenant})` : ""}; rolled back, the user may retry`);
    return;
  }
  console.error(`[rbac] ${attempt} failed for ${actor.domain} user ${actor.userId}${tenant ? ` (tenant ${tenant})` : ""}: ${describeError(error)}`);
}

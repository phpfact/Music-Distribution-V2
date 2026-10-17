import "server-only";
/**
 * Audit of refused actions (.vibe/memory/role-privilege-management.md,
 * "Security"): every action refused for a missing privilege writes one
 * `authz.denied` row to the control-plane audit log.
 */
import type { AuditActorType } from "@/generated/prisma/control/client";
import { recordAudit } from "@/lib/audit";
import { getControlDb } from "@/lib/db/control";
import { describeError } from "@/lib/platform-auth/session";
import type { RoleState } from "./resolver";

/** One refused action: who, where, which privilege, and why it was refused. */
export type AuthzDenial = {
  actorType: AuditActorType;
  /** The platform owner's or tenant user's id. */
  actorId: string;
  /** The tenant of a tenant/customer action; null on the platform. */
  tenantId: string | null;
  /** The privilege the action needed (a catalog key, never a secret). */
  permission: string;
  roleState: RoleState;
  ipAddress?: string | null;
};

/**
 * Description: Record that an action was refused for a missing privilege.
 * Input: The denial (actor, tenant, needed privilege, role state, client address).
 * Output: Nothing. Writes an `authz.denied` audit row and a warning log line.
 *   Never throws: a failed audit write is logged, and the action stays refused.
 * Use case: authorizePlatformAction, authorizeTenantAction, authorizeCustomerAction.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function recordAuthzDenial(denial: AuthzDenial): Promise<void> {
  // Step 1: a log line for operators (ids and the key only; nothing secret).
  console.warn(
    `[authz] denied ${denial.permission} for ${denial.actorType} ${denial.actorId}` +
      `${denial.tenantId ? ` (tenant ${denial.tenantId})` : ""}: role ${denial.roleState}`,
  );

  // Step 2: the durable audit row (control plane, append-only).
  try {
    await recordAudit(getControlDb(), {
      actorType: denial.actorType,
      actorId: denial.actorId,
      tenantId: denial.tenantId,
      action: "authz.denied",
      targetType: "permission",
      targetId: denial.permission,
      metadata: { permission: denial.permission, roleState: denial.roleState },
      ipAddress: denial.ipAddress,
    });
  } catch (error) {
    console.error(`[authz] audit "authz.denied" not written: ${describeError(error)}`);
  }
}

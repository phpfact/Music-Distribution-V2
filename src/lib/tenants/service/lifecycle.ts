import "server-only";
/**
 * Suspending, reactivating and retrying setup (docs/tenant-management.md §8.3).
 *
 * Every state change is a conditional update (`WHERE id = … AND status = …`),
 * so two concurrent clicks cannot both apply it; the audit row is written in
 * the same transaction, so it exists if and only if the change does.
 */
import type { Prisma, TenantStatus } from "@/generated/prisma/control/client";
import { recordAudit } from "@/lib/audit";
import { getControlDb } from "@/lib/db/control";
import { evictTenantDb } from "@/lib/db/tenant";
import { describeError } from "@/lib/platform-auth/session";
import { isProvisioningRunning } from "@/lib/provisioning";
import { consumeRateLimit } from "@/lib/rate-limit";
import { validateSuspensionReason } from "@/lib/tenants/rules";
import {
  isUuid,
  ownerAudit,
  type ServiceFailure,
  type TenantActor,
  UNAVAILABLE_MESSAGE,
} from "./common";

export type LifecycleResult =
  | { ok: true }
  | ServiceFailure<"not_found" | "invalid_state" | "validation" | "rate_limited" | "unavailable">;

const NOT_FOUND: LifecycleResult = {
  ok: false,
  reason: "not_found",
  message: "This tenant does not exist.",
};
const UNAVAILABLE: LifecycleResult = { ok: false, reason: "unavailable", message: UNAVAILABLE_MESSAGE };

const RETRY_LIMIT = { limit: 10, windowSeconds: 15 * 60 };

class StateMismatch extends Error {}

/**
 * Moves the tenant from `from` to the new state and records the audit event,
 * in one transaction. Refusals say whether the tenant is missing or merely in
 * another state.
 */
async function transition(
  id: string,
  from: TenantStatus,
  /** Applies the conditional update (and its audit row); returns the rows changed. */
  change: (tx: Prisma.TransactionClient) => Promise<number>,
  wrongState: string,
): Promise<LifecycleResult> {
  const db = getControlDb();
  try {
    await db.$transaction(async (tx) => {
      if ((await change(tx)) !== 1) throw new StateMismatch();
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof StateMismatch) {
      const exists = await db.tenant.count({ where: { id } }).catch(() => 1);
      return exists === 0 ? NOT_FOUND : { ok: false, reason: "invalid_state", message: wrongState };
    }
    console.error(`[tenants] could not change tenant ${id} from ${from}: ${describeError(error)}`);
    return UNAVAILABLE;
  }
}

/** Only from `active`. Data, database and files are kept. */
export async function suspendTenant(
  id: string,
  reason: string,
  actor: TenantActor,
): Promise<LifecycleResult> {
  if (!isUuid(id)) return NOT_FOUND;
  const validReason = validateSuspensionReason(typeof reason === "string" ? reason : "");
  if (!validReason.ok) return { ok: false, reason: "validation", message: validReason.error };

  const result = await transition(
    id,
    "active",
    async (tx) => {
      const { count } = await tx.tenant.updateMany({
        where: { id, status: "active" },
        data: { status: "suspended", statusReason: validReason.value, suspendedAt: new Date() },
      });
      if (count === 1) {
        await recordAudit(tx, {
          ...ownerAudit(actor),
          tenantId: id,
          action: "tenant.suspended",
          targetType: "tenant",
          targetId: id,
          metadata: { reason: validReason.value },
        });
      }
      return count;
    },
    "Only an active tenant can be suspended.",
  );
  // No pooled connection may keep serving the tenant after this.
  if (result.ok) evictTenantDb(id);
  return result;
}

/** Only from `suspended`. `suspended_at` is kept; the history stays in audit_events. */
export async function reactivateTenant(id: string, actor: TenantActor): Promise<LifecycleResult> {
  return transition(
    id,
    "suspended",
    async (tx) => {
      const { count } = await tx.tenant.updateMany({
        where: { id, status: "suspended" },
        data: { status: "active", statusReason: null },
      });
      if (count === 1) {
        await recordAudit(tx, {
          ...ownerAudit(actor),
          tenantId: id,
          action: "tenant.reactivated",
          targetType: "tenant",
          targetId: id,
        });
      }
      return count;
    },
    "Only a suspended tenant can be reactivated.",
  );
}

/**
 * Checks that setup may be retried: the tenant failed, or is `provisioning`
 * while no run holds its lock (interrupted). The caller then schedules
 * `startProvisioning`; the runner re-checks the state under its lock.
 */
export async function retryProvisioning(id: string, actor: TenantActor): Promise<LifecycleResult> {
  if (!isUuid(id)) return NOT_FOUND;
  const limit = await consumeRateLimit({ key: `tenant-retry:${actor.ownerId}`, ...RETRY_LIMIT });
  if (limit === "limited") {
    return {
      ok: false,
      reason: "rate_limited",
      message: "Setup was retried too often. Wait a few minutes, then try again.",
    };
  }
  if (limit === "unavailable") return UNAVAILABLE;

  try {
    const tenant = await getControlDb().tenant.findUnique({ where: { id }, select: { status: true } });
    if (!tenant) return NOT_FOUND;
    if (tenant.status === "failed") return { ok: true };
    if (tenant.status === "provisioning") {
      return (await isProvisioningRunning(id))
        ? { ok: false, reason: "invalid_state", message: "Setup is already running." }
        : { ok: true };
    }
    return {
      ok: false,
      reason: "invalid_state",
      message: "Setup can only be retried after it failed.",
    };
  } catch (error) {
    console.error(`[tenants] could not check tenant ${id} for a retry: ${describeError(error)}`);
    return UNAVAILABLE;
  }
}

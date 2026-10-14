import "server-only";
/**
 * The tenant admin's row in the tenant's own database (`users`), changed by
 * the edit and the master password reset (docs/tenant-management.md §8.4, §8.5).
 *
 * Runs as the tenant's runtime role on a short-lived connection, like the
 * `create_initial_admin` step that wrote the row: the change proves nothing
 * beyond what the tenant itself may do, and no pooled client is left behind.
 */
import { describeError } from "@/lib/platform-auth/session";
import { sqlState, withLoginClient } from "@/lib/provisioning";
import { loadTenantDatabase } from "@/lib/tenants/database-target";

export type AdminRowChange = { username?: string; email?: string; passwordHash?: string };

export type AdminRowOutcome =
  | { ok: true }
  | { ok: false; problem: "missing" | "username_taken" | "email_taken" | "unavailable" };

const UNIQUE_VIOLATION = "23505";

function constraintOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "constraint" in error) {
    return String((error as { constraint: unknown }).constraint ?? "");
  }
  return "";
}

/**
 * Applies `change` to the admin row found by `username` (the name on record
 * before this change). Never throws; the detail of a failure goes to the log
 * only (the values are not in it: pg keeps them in `detail`, not `message`).
 */
export async function updateTenantAdminRow(
  tenantId: string,
  username: string,
  change: AdminRowChange,
): Promise<AdminRowOutcome> {
  try {
    const target = await loadTenantDatabase(tenantId);
    const updated = await withLoginClient(target, async (client) => {
      const result = await client.query(
        `UPDATE users
         SET username = COALESCE($2, username),
             email = COALESCE($3, email),
             password_hash = COALESCE($4, password_hash),
             updated_at = now()
         WHERE username = $1`,
        [username, change.username ?? null, change.email ?? null, change.passwordHash ?? null],
      );
      return result.rowCount ?? 0;
    });
    return updated === 1 ? { ok: true } : { ok: false, problem: "missing" };
  } catch (error) {
    if (sqlState(error) === UNIQUE_VIOLATION) {
      const constraint = constraintOf(error);
      if (constraint === "users_email_key") return { ok: false, problem: "email_taken" };
      if (constraint === "users_username_key") return { ok: false, problem: "username_taken" };
    }
    console.error(`[tenants] could not update the admin of tenant ${tenantId}: ${describeError(error)}`);
    return { ok: false, problem: "unavailable" };
  }
}

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

/**
 * Description: Read the violated constraint's name from a pg error.
 * Input: Any thrown value.
 * Output: The constraint name, or "".
 * Use case: updateTenantAdminRow (which unique value is taken).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function constraintOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "constraint" in error) {
    return String((error as { constraint: unknown }).constraint ?? "");
  }
  return "";
}

/**
 * Description: Change the tenant admin's row in the tenant's own database.
 * Input: The tenant id, the admin's user name before this change and the change
 *   (username, email and/or password hash).
 * Output: ok, or the problem (missing row, username or email taken, unavailable).
 *   Never throws; runs as the tenant's runtime role on a short-lived connection;
 *   failure details go to the log only (pg keeps values in `detail`).
 * Use case: Edit (username/email) and Reset master password.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
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

import "server-only";
/**
 * The tenant admin's row in the tenant's own database (`users`), changed by
 * the edit and the master password reset (docs/tenant-management.md §8.4, §8.5).
 *
 * Runs as the tenant's runtime role on a short-lived connection, like the
 * `create_initial_admin` step that wrote the row: the change proves nothing
 * beyond what the tenant itself may do, and no pooled client is left behind.
 */
import { getControlDb } from "@/lib/db/control";
import { describeError } from "@/lib/platform-auth/session";
import { sqlState, withLoginClient } from "@/lib/provisioning";
import { loadTenantDatabase } from "@/lib/tenants/database-target";
import { findIdentityConflictsWithSql, IDENTITY_LOCK_ID, type IdentityConflicts } from "@/lib/workspace/identity";

export type AdminRowChange = { username?: string; email?: string; passwordHash?: string };

export type AdminRowOutcome =
  | { ok: true }
  | { ok: false; problem: "missing" | "username_taken" | "email_taken" | "unavailable"; conflicts?: IdentityConflicts };

/** Commits the desired profile plus recovery state before the tenant commit; returns its identity version. */
export type CommitAdminIdentity = (adminId: string) => Promise<number>;

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
 * Input: Tenant ID, legacy username, names/hash and optional durable profile commit.
 * Output: ok, or the problem (missing row, username or email taken, unavailable).
 *   Tenant errors become outcomes; a profile callback refusal is rethrown for
 *   its caller to classify. Runs as the tenant runtime role on a short-lived connection;
 *   failure details go to the log only (pg keeps values in `detail`).
 *   Every change requires the validated primary staff account. Password changes revoke all of its
 *   sessions atomically; username/email edits preserve sessions. Recovery uses
 *   immutable IDs and a versioned desired identity saved before the tenant commit.
 * Use case: Edit (username/email) and Reset master password.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-17
 */
export async function updateTenantAdminRow(
  tenantId: string,
  username: string,
  change: AdminRowChange,
  commitControl?: CommitAdminIdentity,
): Promise<AdminRowOutcome> {
  // A control-plane refusal belongs to the profile service: keep its original
  // error so unique-constraint and optimistic-version errors retain their meaning.
  let controlRefused = false;
  try {
    const target = await loadTenantDatabase(tenantId);
    return await withLoginClient(target, async (client): Promise<AdminRowOutcome> => {
      await client.query("BEGIN");
      try {
        // This is the SAME lock used by registration/approval/account creation.
        // It serializes overlapping profile changes across application processes.
        await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [IDENTITY_LOCK_ID]);
        const control = getControlDb();
        const saved = await control.tenant.findUnique({
          where: { id: tenantId },
          select: { adminUserId: true, adminUsername: true, contactEmail: true,
            adminIdentitySyncPending: true, adminIdentityVersion: true },
        });
        if (!saved) {
          await client.query("ROLLBACK");
          return { ok: false, problem: "missing" };
        }
        // Once captured, the immutable ID survives username edits and interrupted
        // writes. Legacy rows are adopted only through their validated primary user.
        const admins = await client.query<{ id: string; is_primary: boolean; customer_id: string | null }>(
          saved.adminUserId
            ? "SELECT id, is_primary, customer_id FROM users WHERE id = $1 FOR UPDATE"
            : "SELECT id, is_primary, customer_id FROM users WHERE username = $1 FOR UPDATE",
          [saved.adminUserId ?? username],
        );
        const admin = admins.rows[0];
        if (!admin || !admin.is_primary || admin.customer_id !== null) {
          await client.query("ROLLBACK");
          return { ok: false, problem: "missing" };
        }

        // A durable pending record is desired state, so a later edit or password
        // reset can finish a process that stopped between the two commits.
        const desired = {
          ...(saved.adminIdentitySyncPending ? { username: saved.adminUsername, email: saved.contactEmail } : {}),
          ...change,
        };
        const conflicts = await findIdentityConflictsWithSql(client, desired, admin.id);
        if (conflicts.username || conflicts.email) {
          await client.query("ROLLBACK");
          return { ok: false, problem: conflicts.username ? "username_taken" : "email_taken", conflicts };
        }

        let version = saved.adminIdentityVersion;
        if (commitControl) {
          try {
            // The callback atomically saves profile/audit/immutable target/recovery
            // version with an expected-version condition. No tenant change yet.
            version = await commitControl(admin.id);
          } catch (error) {
            controlRefused = true;
            throw error;
          }
        }
        await client.query(
          `UPDATE users
           SET username = COALESCE($2, username),
               email = COALESCE($3, email),
               password_hash = COALESCE($4, password_hash),
               updated_at = now()
           WHERE id = $1`,
          [admin.id, desired.username ?? null, desired.email ?? null, desired.passwordHash ?? null],
        );
        if (change.passwordHash !== undefined) {
          // Preserve AUD-001/002: a reset and every old-session revocation commit together.
          await client.query("DELETE FROM user_sessions WHERE user_id = $1", [admin.id]);
        }
        await client.query("COMMIT");
        if (saved.adminIdentitySyncPending || commitControl) {
          // Operational acknowledgement does not change the profile's updatedAt.
          // An older request can never clear a newer desired identity revision.
          await control.$executeRaw`
            UPDATE tenants SET admin_identity_sync_pending = false
            WHERE id = ${tenantId}::uuid AND admin_user_id = ${admin.id}::uuid
              AND admin_identity_version = ${version}`.catch((error: unknown) => {
            console.error(`[tenants] tenant ${tenantId}: identity synchronized; recovery acknowledgement pending: ${describeError(error)}`);
          });
        }
        return { ok: true };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    });
  } catch (error) {
    if (controlRefused) throw error;
    if (sqlState(error) === UNIQUE_VIOLATION) {
      const constraint = constraintOf(error);
      if (constraint === "users_email_key") return { ok: false, problem: "email_taken" };
      if (constraint === "users_username_key") return { ok: false, problem: "username_taken" };
    }
    console.error(`[tenants] could not update the admin of tenant ${tenantId}: ${describeError(error)}`);
    return { ok: false, problem: "unavailable" };
  }
}

import "server-only";
/**
 * Applies the tenant migrations without the Prisma CLI (docs/tenant-management.md §6.3).
 *
 * The production image has no Prisma CLI, so the application runs the SQL
 * itself. It keeps Prisma's own bookkeeping (lock, `_prisma_migrations` table,
 * checksums), so `prisma migrate deploy/status` (prisma/migrate-tenants.ts)
 * agree with what was applied here.
 */
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Client } from "pg";
import { classifyError, describeForLog, ProvisioningError, sqlState } from "./errors";

/** Prisma Migrate's advisory lock id: holding it keeps the CLI out while we migrate. */
export const PRISMA_MIGRATION_LOCK_ID = 72707369;
// Waiting longer than this for another migration of the same database means
// something is stuck; the step fails and can be retried.
const MIGRATION_LOCK_TIMEOUT = "60s";

// Prisma's exact table (prisma-engines, PostgreSQL flavour), so the CLI reads
// and extends it as its own.
const CREATE_MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS public."_prisma_migrations" (
    "id"                    VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum"              VARCHAR(64) NOT NULL,
    "finished_at"           TIMESTAMPTZ,
    "migration_name"        VARCHAR(255) NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        TIMESTAMPTZ,
    "started_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count"   INTEGER NOT NULL DEFAULT 0
)`;

export type TenantMigration = {
  /** The directory name, e.g. "20261013173117_init". Sorting by it is applying order. */
  name: string;
  sql: string;
  /** SHA-256 (hex) of the file's bytes, as Prisma computes it. */
  checksum: string;
};

/**
 * Description: Locate the tenant migrations folder.
 * Input: None.
 * Output: `<cwd>/prisma/tenant/migrations` (the production image copies them there).
 * Use case: readTenantMigrations.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function tenantMigrationsDirectory(): string {
  return path.join(process.cwd(), "prisma/tenant/migrations");
}

/**
 * Description: Read every tenant migration with its checksum.
 * Input: None.
 * Output: The migrations in name order (SQL and SHA-256 checksum); throws when none exist.
 * Use case: The apply_migrations step and latestTenantMigration.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function readTenantMigrations(): Promise<TenantMigration[]> {
  const directory = tenantMigrationsDirectory();
  const entries   = await readdir(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (names.length === 0) {
    throw new ProvisioningError("internal", "No tenant migrations were found on the server.");
  }
  return Promise.all(
    names.map(async (name) => {
      const bytes = await readFile(path.join(directory, name, "migration.sql"));
      return {
        name,
        sql: bytes.toString("utf8"),
        checksum: createHash("sha256").update(bytes).digest("hex"),
      };
    }),
  );
}

/**
 * Description: Name the newest tenant migration.
 * Input: None.
 * Output: Its folder name: what a current tenant database is at.
 * Use case: Schema status of tenants.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function latestTenantMigration(): Promise<string> {
  const migrations = await readTenantMigrations();
  return (migrations.at(-1) as TenantMigration).name;
}

// ---------------------------------------------------------------------------
// Comparing the database with the migration files

export type AppliedMigrationRow = {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

export type MigrationPlan =
  | { ok: true; pending: TenantMigration[]; applied: string[] }
  | { ok: false; problem: string };

/**
 * Description: Decide what still has to be applied to a tenant database.
 * Input: The local migrations and the database's bookkeeping rows.
 * Output: The pending migrations, or why the database cannot be migrated: a failed
 *   unrolled migration, one from unknown files, or one changed after it was
 *   applied. Rolled-back rows are history only, as for Prisma.
 * Use case: applyTenantMigrations and existing-database checks.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function planMigrations(
  local: readonly TenantMigration[],
  rows: readonly AppliedMigrationRow[],
): MigrationPlan {
  const byName  = new Map(local.map((migration) => [migration.name, migration]));
  const applied = new Set<string>();
  for (const row of rows) {
    if (row.rolled_back_at !== null) continue;
    if (row.finished_at === null) {
      return {
        ok: false,
        problem: `Migration ${row.migration_name} failed earlier and was not rolled back. Inspect the database and resolve it (prisma migrate resolve), then retry.`,
      };
    }
    const migration = byName.get(row.migration_name);
    if (!migration) {
      return {
        ok: false,
        problem: `The database has migration ${row.migration_name} applied, which this platform does not have.`,
      };
    }
    if (migration.checksum !== row.checksum) {
      return {
        ok: false,
        problem: `Migration ${row.migration_name} was changed after it was applied to this database.`,
      };
    }
    applied.add(row.migration_name);
  }
  return {
    ok: true,
    pending: local.filter((migration) => !applied.has(migration.name)),
    applied: [...applied],
  };
}

/**
 * Description: Read a database's migration bookkeeping rows.
 * Input: An open client.
 * Output: The `_prisma_migrations` rows, or null when the table does not exist.
 * Use case: applyTenantMigrations and existing-database checks.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function readAppliedMigrations(client: Client): Promise<AppliedMigrationRow[] | null> {
  const exists = await client.query<{ present: boolean }>(
    "SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present",
  );
  if (!exists.rows[0]?.present) return null;
  const result = await client.query<AppliedMigrationRow>(
    `SELECT migration_name, checksum, finished_at, rolled_back_at
     FROM public."_prisma_migrations" ORDER BY started_at, migration_name`,
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Applying

/**
 * Description: Take Prisma's migration advisory lock on a tenant database.
 * Input: An open client.
 * Output: Nothing; a busy lock becomes a retryable resource_conflict error.
 * Use case: applyTenantMigrations.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
async function takeMigrationLock(client: Client): Promise<void> {
  await client.query(`SET lock_timeout = '${MIGRATION_LOCK_TIMEOUT}'`);
  try {
    await client.query("SELECT pg_advisory_lock($1)", [PRISMA_MIGRATION_LOCK_ID]);
  } catch (error) {
    if (sqlState(error) === "55P03") {
      throw new ProvisioningError(
        "resource_conflict",
        "Another schema migration of this database is still running. Retry when it has finished.",
        { cause: error, retryable: true },
      );
    }
    throw error;
  } finally {
    await client.query("RESET lock_timeout").catch(() => undefined);
  }
}

/**
 * Description: Apply one migration together with its bookkeeping row.
 * Input: An open client and the migration.
 * Output: Nothing. Row and migration commit in one transaction (never a half-applied
 *   looking row); a failure is recorded afterwards, already rolled back, so
 *   later runs apply it again.
 * Use case: applyTenantMigrations.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
async function applyMigration(client: Client, migration: TenantMigration): Promise<void> {
  const id = randomUUID();
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO public."_prisma_migrations" (id, checksum, migration_name, started_at, applied_steps_count)
       VALUES ($1, $2, $3, now(), 0)`,
      [id, migration.checksum, migration.name],
    );
    await client.query(migration.sql);
    await client.query(
      `UPDATE public."_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1`,
      [id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    await client
      .query(
        `INSERT INTO public."_prisma_migrations"
           (id, checksum, migration_name, logs, started_at, rolled_back_at, applied_steps_count)
         VALUES ($1, $2, $3, $4, now(), now(), 0)`,
        [randomUUID(), migration.checksum, migration.name, describeForLog(error)],
      )
      .catch(() => undefined);
    throw migrationFailed(migration, error);
  }
}

/**
 * Description: Explain a migration failure safely.
 * Input: The migration and the error.
 * Output: A ProvisioningError: connection lost, privilege refused, or a schema mismatch.
 * Use case: applyMigration.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function migrationFailed(migration: TenantMigration, error: unknown): ProvisioningError {
  const code = classifyError(error);
  if (code === "unreachable" || code === "permission_denied") {
    return new ProvisioningError(
      code,
      code === "unreachable"
        ? `The connection to PostgreSQL was lost while applying migration ${migration.name}. Nothing from it was kept. Retry setup.`
        : `PostgreSQL refused a privilege needed by migration ${migration.name}. Nothing from it was kept. Check the administrative login's privileges, then retry.`,
      { cause: error },
    );
  }
  const state = sqlState(error);
  return new ProvisioningError(
    "schema_mismatch",
    `Migration ${migration.name} could not be applied${state ? ` (PostgreSQL error ${state})` : ""}; nothing from it was kept. The database's schema does not match what the migration expects. See the server log for details.`,
    { cause: error },
  );
}

/**
 * Description: Bring a tenant database's schema up to date.
 * Input: An open client (administrative login) and the migrations.
 * Output: The names applied now (empty when already current).
 * Use case: The apply_migrations provisioning step.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function applyTenantMigrations(
  client: Client,
  migrations: readonly TenantMigration[],
): Promise<string[]> {
  // The migration files use unqualified names. Like the Prisma CLI (schema
  // "public"), pin the search path, so a schema that happens to be named
  // after the administrative login cannot receive the tables.
  await client.query("SET search_path TO public");
  await takeMigrationLock(client);
  try {
    await client.query(CREATE_MIGRATIONS_TABLE);
    const plan = planMigrations(migrations, (await readAppliedMigrations(client)) ?? []);
    if (!plan.ok) throw new ProvisioningError("schema_mismatch", plan.problem);
    for (const migration of plan.pending) await applyMigration(client, migration);
    return plan.pending.map((migration) => migration.name);
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [PRISMA_MIGRATION_LOCK_ID])
      .catch(() => undefined);
  }
}

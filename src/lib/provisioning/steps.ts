import "server-only";
/**
 * The provisioning steps (docs/tenant-management.md §6.2).
 *
 * Each step is idempotent on its own, on top of the runner skipping steps
 * already recorded as done: a crash can happen between a step's effect and
 * its record, and the retry must then converge instead of failing or
 * duplicating. Objects this platform creates carry an ownership marker
 * (COMMENT 'md-tenant:<tenantId>'); an object with the right name but without
 * our marker belongs to someone else and is never changed.
 */
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import type {
  ProvisioningRunStatus,
  ProvisioningStep,
  TenantDatabaseMode,
} from "@/generated/prisma/control/client";
import { getControlDb } from "../db/control";
import type { TenantDatabase } from "../db/tenant";
import { checkSubdomainDns, type DnsResolver } from "../domains/dns";
import { getEnv } from "../env";
import {
  adminLoginName,
  findDatabaseWith,
  findRoleWith,
  MAINTENANCE_DATABASE,
  ownershipMarker,
  passwordClause,
  quotedAdminLogin,
  quoteTenantIdentifier,
  sqlLiteral,
  userRelations,
  withAdminClient,
  withLoginClient,
} from "./admin";
import { ProvisioningError, sqlState } from "./errors";
import { runDatabaseChecks } from "./existing-database";
import {
  applyTenantMigrations,
  planMigrations,
  readAppliedMigrations,
  readTenantMigrations,
} from "./migrations";

export type { ProvisioningStep };

const PROVISIONED_PLAN: readonly ProvisioningStep[] = [
  "create_database_user",
  "create_database",
  "grant_privileges",
  "apply_migrations",
  "create_initial_admin",
  "register_domain",
  "verify",
];

const EXISTING_PLAN: readonly ProvisioningStep[] = [
  "check_database",
  "grant_privileges",
  "apply_migrations",
  "create_initial_admin",
  "register_domain",
  "verify",
];

/** The steps of a tenant's setup, in order. */
export function provisioningPlan(mode: TenantDatabaseMode): ProvisioningStep[] {
  return [...(mode === "existing" ? EXISTING_PLAN : PROVISIONED_PLAN)];
}

/** For messages: "Setup failed while <activity>". */
export const STEP_ACTIVITY: Record<ProvisioningStep, string> = {
  create_database_user: "creating the database user",
  create_database: "creating the database",
  check_database: "checking the existing database",
  grant_privileges: "granting privileges",
  apply_migrations: "installing the schema",
  create_initial_admin: "creating the admin account",
  register_domain: "registering the domain",
  verify: "verifying the setup",
};

export type StepTenant = {
  id: string;
  name: string;
  adminUsername: string;
  contactEmail: string;
  databaseMode: TenantDatabaseMode;
};

export type StepContext = {
  tenant: StepTenant;
  runId: string;
  /** The run before this one, if any (after stale runs were marked interrupted). */
  previousRun: { status: ProvisioningRunStatus; step: ProvisioningStep | null } | null;
  /** The tenant's database and runtime login, decrypted on first use. */
  target(): Promise<TenantDatabase>;
  dnsResolver?: DnsResolver;
};

function conflict(message: string): ProvisioningError {
  return new ProvisioningError("resource_conflict", message);
}

// ---------------------------------------------------------------------------
// create_database_user

async function createDatabaseUser(ctx: StepContext): Promise<void> {
  const target = await ctx.target();
  const role = quoteTenantIdentifier(target.user, "user");
  const marker = ownershipMarker(ctx.tenant.id);
  const password = passwordClause(target.password);

  await withAdminClient(MAINTENANCE_DATABASE, target.port, async (client) => {
    const existing = await findRoleWith(client, target.user);
    if (existing) {
      if (existing.comment !== marker) throw foreignRole(target.user);
      // Ours from an earlier attempt: make sure it has the stored password.
      await client.query(`ALTER ROLE ${role} ${password}`);
      return;
    }
    // Role and marker in one transaction: there is no moment in which our
    // role exists without the marker that proves it is ours.
    await client.query("BEGIN");
    try {
      await client.query(
        `CREATE ROLE ${role} LOGIN ${password} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20`,
      );
      await client.query(`COMMENT ON ROLE ${role} IS ${sqlLiteral(marker)}`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      // Created by someone else between the lookup and CREATE ROLE.
      if (sqlState(error) === "42710") throw foreignRole(target.user);
      throw error;
    }
  });
}

function foreignRole(name: string): ProvisioningError {
  return conflict(
    `A PostgreSQL role named "${name}" already exists and was not created for this tenant, so it was left untouched. Resolve the name clash on the database server, then retry setup.`,
  );
}

// ---------------------------------------------------------------------------
// create_database

async function createDatabase(ctx: StepContext): Promise<void> {
  const target = await ctx.target();
  const database = quoteTenantIdentifier(target.database, "database");
  const marker = ownershipMarker(ctx.tenant.id);

  await withAdminClient(MAINTENANCE_DATABASE, target.port, async (client) => {
    let existing = await findDatabaseWith(client, target.database);
    if (!existing) {
      try {
        // CREATE DATABASE cannot run in a transaction, so the marker follows
        // separately. A crash in between is the adoption case below.
        await client.query(`CREATE DATABASE ${database} TEMPLATE template0 ENCODING 'UTF8'`);
        await client.query(`COMMENT ON DATABASE ${database} IS ${sqlLiteral(marker)}`);
        return;
      } catch (error) {
        if (sqlState(error) !== "42P04") throw error;
        // Created concurrently: judged like any database that already exists.
        existing = await findDatabaseWith(client, target.database);
        if (!existing) throw error;
      }
    }
    if (existing.comment === marker) return;
    if (existing.comment === null && (await mayAdopt(ctx, existing.owner, target))) {
      await client.query(`COMMENT ON DATABASE ${database} IS ${sqlLiteral(marker)}`);
      console.info(
        `[provisioning] tenant ${ctx.tenant.id}: adopted database ${target.database} left by an interrupted attempt`,
      );
      return;
    }
    throw conflict(
      `A database named "${target.database}" already exists and was not created for this tenant, so it was left untouched. Resolve the name clash on the database server, then retry setup.`,
    );
  });
}

/**
 * A database without any marker is ours only in the crash window between
 * CREATE DATABASE and COMMENT: the previous attempt stopped at this very
 * step, the administrative login owns it and nothing was put in it yet.
 */
async function mayAdopt(ctx: StepContext, owner: string, target: TenantDatabase): Promise<boolean> {
  const previous = ctx.previousRun;
  if (previous?.status !== "failed" || previous.step !== "create_database") return false;
  if (owner !== adminLoginName()) return false;
  const relations = await withAdminClient(target.database, target.port, userRelations);
  return relations.length === 0;
}

// ---------------------------------------------------------------------------
// check_database (existing-database mode)

async function checkDatabase(ctx: StepContext): Promise<void> {
  const target = await ctx.target();
  const checks = await runDatabaseChecks(target, { excludeTenantId: ctx.tenant.id });
  const failed = checks.find((check) => check.status === "fail");
  if (failed) throw new ProvisioningError(failed.code ?? "internal", failed.message);
}

// ---------------------------------------------------------------------------
// grant_privileges

async function grantPrivileges(ctx: StepContext): Promise<void> {
  const target = await ctx.target();
  const database = quoteTenantIdentifier(target.database, "database");
  const role = quoteTenantIdentifier(target.user, "user");
  const admin = quotedAdminLogin();

  if (ctx.tenant.databaseMode === "provisioned") {
    // Only for a database we created: an attached one's database-level
    // privileges belong to its owner.
    await withAdminClient(MAINTENANCE_DATABASE, target.port, async (client) => {
      await client.query(
        `REVOKE ALL ON DATABASE ${database} FROM PUBLIC; GRANT CONNECT, TEMPORARY ON DATABASE ${database} TO ${role}`,
      );
    });
  }
  // One simple-protocol query is one implicit transaction: all or nothing.
  // The default privileges cover every table the migrations create later.
  await withAdminClient(target.database, target.port, async (client) => {
    await client.query(
      [
        "REVOKE ALL ON SCHEMA public FROM PUBLIC",
        `GRANT USAGE ON SCHEMA public TO ${role}`,
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${admin} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${admin} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`,
      ].join("; "),
    );
  });
}

// ---------------------------------------------------------------------------
// apply_migrations

async function applyMigrations(ctx: StepContext): Promise<void> {
  const target = await ctx.target();
  const role = quoteTenantIdentifier(target.user, "user");
  const migrations = await readTenantMigrations();
  const latest = migrations.at(-1)?.name ?? null;
  const control = getControlDb();

  try {
    await withAdminClient(target.database, target.port, async (client) => {
      const applied = await applyTenantMigrations(client, migrations);
      // Existing objects too (e.g. a database attached with our schema).
      // The bookkeeping table is the migration login's business only.
      await client.query(
        [
          `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
          `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
          `REVOKE ALL ON TABLE public."_prisma_migrations" FROM ${role}`,
        ].join("; "),
      );
      if (applied.length > 0) {
        console.info(`[provisioning] tenant ${ctx.tenant.id}: applied ${applied.join(", ")}`);
      }
    });
  } catch (error) {
    if (error instanceof ProvisioningError && error.code === "schema_mismatch") {
      await control.tenant.update({ where: { id: ctx.tenant.id }, data: { schemaStatus: "failed" } });
    }
    throw error;
  }
  await control.tenant.update({
    where: { id: ctx.tenant.id },
    data: { schemaStatus: "current", schemaVersion: latest, schemaMigratedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// create_initial_admin

/** Runs as the tenant role: proves the runtime login can write its own database. */
async function createInitialAdmin(ctx: StepContext): Promise<void> {
  const target = await ctx.target();
  const control = getControlDb();
  const tenant = await control.tenant.findUnique({
    where: { id: ctx.tenant.id },
    select: { pendingAdminPasswordHash: true },
  });
  const pendingHash = tenant?.pendingAdminPasswordHash ?? null;
  const { adminUsername, contactEmail, name } = ctx.tenant;

  await withLoginClient(target, async (client) => {
    await client.query("BEGIN");
    try {
      await writeInitialAdmin(client, { username: adminUsername, email: contactEmail, name }, pendingHash);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });

  if (pendingHash === null) return;
  // Conditional: if the master password was reset meanwhile, its new hash
  // must not be thrown away. The step then fails and the retry writes it.
  const { count } = await control.tenant.updateMany({
    where: { id: ctx.tenant.id, pendingAdminPasswordHash: pendingHash },
    data: { pendingAdminPasswordHash: null },
  });
  if (count !== 1) {
    throw new ProvisioningError(
      "internal",
      "The master password was changed while the admin account was being created. Retry setup to apply the new one.",
      { retryable: true },
    );
  }
}

async function writeInitialAdmin(
  client: Client,
  admin: { username: string; email: string; name: string },
  pendingHash: string | null,
): Promise<void> {
  const role = await client.query<{ id: string }>(
    `INSERT INTO roles (id, key, name, is_system, updated_at)
     VALUES ($1, 'owner', 'Owner', true, now())
     ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, is_system = true, updated_at = now()
     RETURNING id`,
    [randomUUID()],
  );
  const roleId = role.rows[0]?.id as string;

  const existing = await client.query<{ id: string }>(
    "SELECT id FROM users WHERE username = $1 FOR UPDATE",
    [admin.username],
  );
  let userId = existing.rows[0]?.id;
  if (userId) {
    // Written by an earlier attempt. Only a pending hash may replace its password.
    if (pendingHash !== null) {
      await client.query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1", [
        userId,
        pendingHash,
      ]);
    }
  } else {
    if (pendingHash === null) {
      throw new ProvisioningError(
        "invalid_state",
        "The admin account's password is no longer on record. Reset the master password, then retry setup.",
      );
    }
    const taken = await client.query("SELECT 1 FROM users WHERE email = $1", [admin.email]);
    if ((taken.rowCount ?? 0) > 0) {
      throw new ProvisioningError(
        "admin_conflict",
        `Another user in the tenant database already has the email ${admin.email}. Change the tenant admin's email or that user's, then retry setup.`,
      );
    }
    userId = randomUUID();
    await client.query(
      `INSERT INTO users (id, email, username, password_hash, name, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'active', now())`,
      [userId, admin.email, admin.username, pendingHash, admin.name],
    );
  }
  await client.query(
    "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [userId, roleId],
  );
}

// ---------------------------------------------------------------------------
// register_domain

/** The subdomain row is inserted with the tenant (it reserves the name); this confirms it. */
async function registerDomain(ctx: StepContext): Promise<void> {
  await subdomainRow(ctx.tenant.id);
}

async function subdomainRow(tenantId: string) {
  const row = await getControlDb().tenantDomain.findFirst({
    where: { tenantId, type: "subdomain" },
    select: { id: true, hostname: true, verifiedAt: true },
  });
  if (!row) {
    throw new ProvisioningError(
      "invalid_state",
      "The tenant has no SaaS subdomain on record. Set one by editing the tenant, then retry setup.",
    );
  }
  return row;
}

// ---------------------------------------------------------------------------
// verify

async function verify(ctx: StepContext): Promise<void> {
  await verifySubdomain(ctx);
  const target = await ctx.target();

  // As the tenant role: the runtime credentials work and the admin exists.
  await withLoginClient(target, async (client) => {
    await client.query("SELECT 1");
    const admin = await client.query(
      `SELECT 1 FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id AND r.key = 'owner'
       WHERE u.username = $1 AND u.status = 'active' AND u.password_hash IS NOT NULL`,
      [ctx.tenant.adminUsername],
    );
    if ((admin.rowCount ?? 0) === 0) {
      throw new ProvisioningError(
        "invalid_state",
        "The tenant admin account is missing from the tenant database or is not an active owner.",
      );
    }
  });

  // The tenant role cannot read `_prisma_migrations` (deliberately), so the
  // schema version is confirmed through the administrative login.
  const migrations = await readTenantMigrations();
  const plan = await withAdminClient(target.database, target.port, async (client) =>
    planMigrations(migrations, (await readAppliedMigrations(client)) ?? []),
  );
  const tenant = await getControlDb().tenant.findUnique({
    where: { id: ctx.tenant.id },
    select: { schemaStatus: true, schemaVersion: true },
  });
  const latest = migrations.at(-1)?.name;
  if (
    !plan.ok ||
    plan.pending.length > 0 ||
    tenant?.schemaStatus !== "current" ||
    tenant.schemaVersion !== latest
  ) {
    throw new ProvisioningError(
      "schema_mismatch",
      `The tenant database is not at the latest schema version (${latest}). Retry setup.`,
    );
  }
}

async function verifySubdomain(ctx: StepContext): Promise<void> {
  const row = await subdomainRow(ctx.tenant.id);
  const control = getControlDb();
  const result = await checkSubdomainDns(row.hostname, getEnv().platformBaseDomain, ctx.dnsResolver);
  const now = new Date();
  if (!result.ok) {
    await control.tenantDomain.update({
      where: { id: row.id },
      data: { lastCheckedAt: now, lastCheckError: result.message.slice(0, 300) },
    });
    throw new ProvisioningError("dns", result.message);
  }
  await control.tenantDomain.update({
    where: { id: row.id },
    data: { status: "active", verifiedAt: row.verifiedAt ?? now, lastCheckedAt: now, lastCheckError: null },
  });
}

// ---------------------------------------------------------------------------

export const STEPS: Record<ProvisioningStep, (ctx: StepContext) => Promise<void>> = {
  create_database_user: createDatabaseUser,
  create_database: createDatabase,
  check_database: checkDatabase,
  grant_privileges: grantPrivileges,
  apply_migrations: applyMigrations,
  create_initial_admin: createInitialAdmin,
  register_domain: registerDomain,
  verify,
};

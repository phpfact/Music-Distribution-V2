/**
 * The provisioning engine (src/lib/provisioning) against the scratch control
 * database and the dev PostgreSQL server (docs/tenant-management.md §6, §10).
 *
 * Every database and role created here is named t_test_...; the last test
 * drops exactly those and proves the server's list of databases and roles is
 * what it was before (tests/support/tenant-resources.ts).
 */
import { createHash, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { verifyPassword } from "@/lib/platform-auth/password";
import {
  checkExistingDatabase,
  databaseExists,
  isProvisioningRunning,
  latestTenantMigration,
  type ProvisioningActor,
  type ProvisioningOptions,
  type ProvisioningOutcome,
  type ProvisioningStep,
  provisioningPlan,
  roleExists,
  runProvisioning,
  setRolePassword,
  testDatabaseLogin,
} from "@/lib/provisioning";
import { describeForLog, redact } from "@/lib/provisioning/errors";
import {
  type AppliedMigrationRow,
  applyTenantMigrations,
  planMigrations,
  PRISMA_MIGRATION_LOCK_ID,
  type TenantMigration,
} from "@/lib/provisioning/migrations";
import * as tenantMigrations from "@/lib/provisioning/migrations";
import { closeAppDatabase } from "./support/app-connections";
import { captureConsole } from "./support/console";
import { clearTenantTables, connectTo, connectToTestDatabase } from "./support/postgres";
import { childEnv, postgresEnv, runProcess } from "./support/process";
import {
  connectAs,
  connectionFailure,
  insertProvisioningTenant,
  postgresPort,
  TenantResources,
  testIdentifiers,
  type TestTenant,
} from "./support/tenant-resources";

const SLOW = { timeout: 60_000 };
const OWNER: ProvisioningActor = {
  type: "super_admin",
  ownerId: randomUUID(),
  ipAddress: "203.0.113.7",
};
const SYSTEM: ProvisioningActor = { type: "system" };
const ADMIN_LOGIN = process.env.POSTGRES_USER ?? "";
const SCRATCH_DATABASE = process.env.PLATFORM_TEST_DATABASE ?? "";

let db: Client;
let resources: TenantResources;
let consoleOutput: { text: () => string };
let inventoryBefore: { databases: string[]; roles: string[] };

// Everything a caller or the log could see, checked for secrets at the end.
const observed: unknown[] = [];
const secrets = new Set<string>();

beforeAll(async () => {
  db = await connectToTestDatabase();
  await clearTenantTables(db);
  resources = await TenantResources.open(db);
  inventoryBefore = await resources.inventory();
  consoleOutput = captureConsole();
  for (const name of ["POSTGRES_PASSWORD", "TENANT_SECRETS_KEY"]) {
    const value = process.env[name];
    if (value) secrets.add(value);
  }
});

afterAll(async () => {
  vi.restoreAllMocks();
  // Normally a no-op: the last test already cleaned up. Runs again if it failed early.
  await resources.cleanup();
  await clearTenantTables(db);
  await resources.close();
  await db.end();
  await closeAppDatabase();
});

async function run(
  tenantId: string,
  actor: ProvisioningActor = OWNER,
  options?: ProvisioningOptions,
): Promise<ProvisioningOutcome> {
  const outcome = await runProvisioning(tenantId, actor, options);
  observed.push(outcome);
  return outcome;
}

async function newTenant(
  options: Parameters<typeof insertProvisioningTenant>[1],
): Promise<TestTenant> {
  const tenant = await insertProvisioningTenant(db, options);
  secrets.add(tenant.databasePassword);
  secrets.add(tenant.adminPassword);
  secrets.add(tenant.pendingHash);
  return tenant;
}

type TenantRow = {
  status: string;
  status_reason: string | null;
  activated_at: Date | null;
  schema_status: string;
  schema_version: string | null;
  schema_migrated_at: Date | null;
  pending_admin_password_hash: string | null;
};

async function tenantRow(id: string): Promise<TenantRow> {
  const result = await db.query<TenantRow>(
    `SELECT status, status_reason, activated_at, schema_status, schema_version, schema_migrated_at,
            pending_admin_password_hash
     FROM tenants WHERE id = $1`,
    [id],
  );
  return result.rows[0] as TenantRow;
}

type RunRow = {
  attempt: number;
  status: string;
  step: string | null;
  error_code: string | null;
  error_message: string | null;
  finished_at: Date | null;
};

async function runs(tenantId: string): Promise<RunRow[]> {
  const result = await db.query<RunRow>(
    `SELECT attempt, status, step, error_code, error_message, finished_at
     FROM tenant_provisioning_runs WHERE tenant_id = $1 ORDER BY attempt`,
    [tenantId],
  );
  return result.rows;
}

async function completedSteps(tenantId: string): Promise<string[]> {
  const result = await db.query<{ step: string }>(
    "SELECT step::text AS step FROM tenant_provisioning_steps WHERE tenant_id = $1 ORDER BY 1",
    [tenantId],
  );
  return result.rows.map((row) => row.step);
}

type AuditRow = { action: string; actor_type: string; actor_id: string | null; ip_address: string | null };

async function audits(tenantId: string): Promise<AuditRow[]> {
  const result = await db.query<AuditRow>(
    `SELECT action, actor_type, actor_id, host(ip_address) AS ip_address
     FROM audit_events WHERE tenant_id = $1 ORDER BY occurred_at, id`,
    [tenantId],
  );
  return result.rows;
}

function loginOf(tenant: TestTenant, overrides: Partial<{ database: string; password: string }> = {}) {
  return {
    database: overrides.database ?? tenant.database,
    user: tenant.user,
    password: overrides.password ?? tenant.databasePassword,
    port: tenant.port,
  };
}

// ---------------------------------------------------------------------------

describe("provisioningPlan", () => {
  it("lists the steps of each mode in order", () => {
    expect(provisioningPlan("provisioned")).toStrictEqual([
      "create_database_user",
      "create_database",
      "grant_privileges",
      "apply_migrations",
      "create_initial_admin",
      "register_domain",
      "verify",
    ]);
    expect(provisioningPlan("existing")).toStrictEqual([
      "check_database",
      "grant_privileges",
      "apply_migrations",
      "create_initial_admin",
      "register_domain",
      "verify",
    ]);
  });
});

describe("planMigrations", () => {
  const local: TenantMigration[] = [
    { name: "001_init", sql: "", checksum: "a".repeat(64) },
    { name: "002_more", sql: "", checksum: "b".repeat(64) },
  ];
  const finished = new Date();
  const row = (
    name: string,
    checksum: string,
    overrides: Partial<AppliedMigrationRow> = {},
  ): AppliedMigrationRow => ({
    migration_name: name,
    checksum,
    finished_at: finished,
    rolled_back_at: null,
    ...overrides,
  });

  it("returns what is not applied yet, ignoring rolled-back attempts", () => {
    const plan = planMigrations(local, [
      row("001_init", "a".repeat(64)),
      row("002_more", "b".repeat(64), { finished_at: null, rolled_back_at: finished }),
    ]);
    expect(plan).toMatchObject({ ok: true, applied: ["001_init"] });
    expect(plan.ok && plan.pending.map((m) => m.name)).toStrictEqual(["002_more"]);
  });

  it.each([
    ["a failed migration that was not rolled back", row("001_init", "a".repeat(64), { finished_at: null }), /failed earlier/],
    ["an unknown applied migration", row("003_foreign", "c".repeat(64)), /does not have/],
    ["a changed migration", row("001_init", "f".repeat(64)), /changed after/],
  ])("refuses %s", (_description, applied, problem) => {
    const plan = planMigrations(local, [applied]);
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.problem).toMatch(problem);
  });
});

describe("log redaction", () => {
  it("removes connection strings, password clauses, verifiers, hashes and known secrets", () => {
    const text = [
      "postgresql://user:pw@host:5432/db",
      "ALTER ROLE x PASSWORD 'SCRAM-SHA-256$4096:abc$def:ghi'",
      "hash $argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA",
      "password=hunter2 token: abc123",
      "the value vt-known-secret-value",
    ].join("\n");
    const result = redact(text, ["vt-known-secret-value"]);
    for (const leaked of ["user:pw", "SCRAM-SHA-256$", "$argon2id$", "hunter2", "abc123", "vt-known-secret-value"]) {
      expect(result).not.toContain(leaked);
    }
    expect(describeForLog(new Error("x", { cause: new Error("postgres://a:b@c/d") }))).not.toContain("a:b");
  });
});

// ---------------------------------------------------------------------------

describe("a provisioned tenant", () => {
  let tenantA: TestTenant;
  let tenantB: TestTenant;
  let outcomeA: ProvisioningOutcome;
  let outcomeB: ProvisioningOutcome;

  beforeAll(async () => {
    tenantA = await newTenant({ label: "alpha" });
    tenantB = await newTenant({ label: "beta" });
    outcomeA = await run(tenantA.id, OWNER);
    outcomeB = await run(tenantB.id, SYSTEM);
  });

  it("succeeds and activates the tenant with the latest schema", async () => {
    expect(outcomeA).toStrictEqual({ status: "succeeded" });
    expect(outcomeB).toStrictEqual({ status: "succeeded" });
    const row = await tenantRow(tenantA.id);
    expect(row).toMatchObject({
      status: "active",
      status_reason: null,
      schema_status: "current",
      schema_version: await latestTenantMigration(),
      pending_admin_password_hash: null,
    });
    expect(row.activated_at).toBeInstanceOf(Date);
    expect(row.schema_migrated_at).toBeInstanceOf(Date);
    const domain = await db.query("SELECT status FROM tenant_domains WHERE tenant_id = $1", [tenantA.id]);
    expect(domain.rows).toStrictEqual([{ status: "active" }]);
  });

  it("creates a dedicated database and a restricted login role, both marked as the tenant's", async () => {
    expect(await resources.comment("database", tenantA.database)).toBe(`md-tenant:${tenantA.id}`);
    expect(await resources.comment("role", tenantA.user)).toBe(`md-tenant:${tenantA.id}`);
    expect(await resources.markedCount(tenantA.id)).toStrictEqual({ databases: 1, roles: 1 });

    const role = await db.query(
      `SELECT rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls,
              rolcanlogin, rolconnlimit
       FROM pg_roles WHERE rolname = $1`,
      [tenantA.user],
    );
    expect(role.rows).toStrictEqual([
      {
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolreplication: false,
        rolbypassrls: false,
        rolcanlogin: true,
        rolconnlimit: 20,
      },
    ]);
    const owner = await db.query(
      "SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1",
      [tenantA.database],
    );
    expect(owner.rows).toStrictEqual([{ owner: ADMIN_LOGIN }]);
    expect(await databaseExists(tenantA.database, tenantA.port)).toBe(true);
    expect(await roleExists(tenantA.user)).toBe(true);
    expect(await databaseExists("t_test_does_not_exist", tenantA.port)).toBe(false);
    expect(await roleExists("t_test_does_not_exist_app")).toBe(false);
  });

  it("creates the admin account in the tenant database with an Argon2id hash and the Master Tenant role", async () => {
    const client = await connectAs(loginOf(tenantA));
    try {
      const users = await client.query<{ username: string; email: string; name: string; status: string; password_hash: string }>(
        "SELECT username, email, name, status, password_hash FROM users",
      );
      expect(users.rows).toHaveLength(1);
      const user = users.rows[0];
      expect(user).toMatchObject({
        username: tenantA.adminUsername,
        email: tenantA.email,
        name: tenantA.name,
        status: "active",
      });
      expect(user?.password_hash.startsWith("$argon2id$")).toBe(true);
      expect(await verifyPassword(user?.password_hash ?? "", tenantA.adminPassword)).toBe(true);

      // The admin is the primary staff account and holds exactly Master Tenant
      // (key "owner" kept, recognised by its system key).
      const roles = await client.query(
        `SELECT r.key, r.name, r.is_system, r.domain::text AS domain, r.system_key, r.status::text AS status, u.is_primary
         FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         JOIN users u ON u.id = ur.user_id WHERE u.username = $1`,
        [tenantA.adminUsername],
      );
      expect(roles.rows).toStrictEqual([
        {
          key: "owner",
          name: "Master Tenant",
          is_system: true,
          domain: "tenant",
          system_key: "master_tenant",
          status: "active",
          is_primary: true,
        },
      ]);
    } finally {
      await client.end();
    }
  });

  it("records every step and one succeeded run, with the audit trail", async () => {
    expect(await completedSteps(tenantA.id)).toStrictEqual([...provisioningPlan("provisioned")].sort());
    expect(await runs(tenantA.id)).toMatchObject([{ attempt: 1, status: "succeeded", error_code: null }]);
    expect(await audits(tenantA.id)).toStrictEqual([
      {
        action: "tenant.provisioning_started",
        actor_type: "super_admin",
        actor_id: OWNER.type === "super_admin" ? OWNER.ownerId : null,
        ip_address: "203.0.113.7",
      },
      { action: "tenant.provisioned", actor_type: "system", actor_id: null, ip_address: null },
    ]);
    expect((await audits(tenantB.id))[0]).toMatchObject({
      action: "tenant.provisioning_started",
      actor_type: "system",
    });
  });

  it("keeps tenants apart: a tenant role reaches neither another tenant's database nor the control plane", async () => {
    // Its own database works.
    expect(await connectionFailure(loginOf(tenantA))).toBeNull();
    // 42501: permission denied for database (CONNECT revoked from PUBLIC).
    expect(await connectionFailure(loginOf(tenantA, { database: tenantB.database }))).toMatchObject({
      code: "42501",
    });
    expect(await connectionFailure(loginOf(tenantB, { database: tenantA.database }))).toMatchObject({
      code: "42501",
    });
    expect(await connectionFailure(loginOf(tenantA, { database: SCRATCH_DATABASE }))).toMatchObject({
      code: "42501",
    });
  });

  it("hides the migration bookkeeping from the tenant role", async () => {
    const client = await connectAs(loginOf(tenantA));
    try {
      await expect(client.query('SELECT * FROM "_prisma_migrations"')).rejects.toMatchObject({
        code: "42501",
      });
      // ...while the application tables are usable.
      await expect(client.query("SELECT count(*) FROM customers")).resolves.toBeDefined();
    } finally {
      await client.end();
    }
  });

  it("agrees with `prisma migrate status`", SLOW, async () => {
    const status = await runProcess(
      "node_modules/.bin/prisma",
      ["migrate", "status", "--config", "prisma/tenant.config.ts"],
      childEnv({
        ...postgresEnv(SCRATCH_DATABASE),
        TENANT_DATABASE: tenantA.database,
        TENANT_DATABASE_PORT: String(tenantA.port),
      }),
    );
    expect(status.code, status.stderr).toBe(0);
    expect(status.stdout).toContain("Database schema is up to date");
  });

  it("is brought up to date by migrate-tenants.ts on its own port", SLOW, async () => {
    const result = await runProcess(
      "node_modules/.bin/tsx",
      ["prisma/migrate-tenants.ts"],
      childEnv(postgresEnv(SCRATCH_DATABASE)),
    );
    expect(result.code, result.output).toBe(0);
    expect(result.stdout).toContain(`ok      ${tenantA.slug}`);
    expect(result.stdout).toContain(`ok      ${tenantB.slug}`);
  });

  it("does not run again for an active or suspended tenant", async () => {
    expect(await run(tenantA.id)).toStrictEqual({ status: "invalid_state", tenantStatus: "active" });
    const suspended = await newTenant({ label: "susp", status: "suspended" });
    expect(await run(suspended.id)).toStrictEqual({
      status: "invalid_state",
      tenantStatus: "suspended",
    });
    expect(await run(randomUUID())).toStrictEqual({ status: "invalid_state", tenantStatus: "not_found" });
    expect(await runs(tenantA.id)).toHaveLength(1);
    expect(await runs(suspended.id)).toHaveLength(0);
  });

  it("changes the role's password with setRolePassword; testDatabaseLogin tells old from new", async () => {
    const newPassword = "vt-rotated-database-password-0123456789";
    secrets.add(newPassword);
    await setRolePassword(tenantB.user, newPassword, tenantB.port);
    const withNew = await testDatabaseLogin(loginOf(tenantB, { password: newPassword }));
    const withOld = await testDatabaseLogin(loginOf(tenantB));
    observed.push(withNew, withOld);
    expect(withNew).toStrictEqual({ ok: true });
    expect(withOld).toMatchObject({ ok: false, code: "auth_failed" });
    // Back to the stored secret, so the tenant stays consistent.
    await setRolePassword(tenantB.user, tenantB.databasePassword, tenantB.port);
    expect(await testDatabaseLogin(loginOf(tenantB))).toStrictEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------

describe("failure and retry", () => {
  it("leaves a failed step's tenant failed, then converges on retry without duplicates", SLOW, async () => {
    const tenant = await newTenant({ label: "retry" });
    const firstSteps: ProvisioningStep[] = [];
    const first = await run(tenant.id, OWNER, {
      hooks: {
        beforeStep(step) {
          firstSteps.push(step);
          if (step === "apply_migrations") throw new Error("vt-injected-failure detail");
        },
      },
    });
    expect(first).toMatchObject({ status: "failed", code: "internal" });
    const message = first.status === "failed" ? first.message : "";
    expect(message).toMatch(/installing the schema/);
    expect(message).not.toContain("vt-injected-failure");
    expect(message.length).toBeLessThanOrEqual(500);
    expect(firstSteps).toStrictEqual([
      "create_database_user",
      "create_database",
      "grant_privileges",
      "apply_migrations",
    ]);
    expect(await tenantRow(tenant.id)).toMatchObject({
      status: "failed",
      status_reason: message,
      activated_at: null,
    });
    expect(await runs(tenant.id)).toMatchObject([
      { attempt: 1, status: "failed", step: "apply_migrations", error_code: "internal", error_message: message },
    ]);
    expect(await completedSteps(tenant.id)).toStrictEqual(
      ["create_database", "create_database_user", "grant_privileges"].sort(),
    );

    const secondSteps: ProvisioningStep[] = [];
    const second = await run(tenant.id, SYSTEM, {
      hooks: {
        beforeStep(step) {
          secondSteps.push(step);
        },
      },
    });
    expect(second).toStrictEqual({ status: "succeeded" });
    // Completed steps were not executed again.
    expect(secondSteps).toStrictEqual(["apply_migrations", "create_initial_admin", "register_domain", "verify"]);
    expect(await tenantRow(tenant.id)).toMatchObject({ status: "active", status_reason: null });
    expect(await runs(tenant.id)).toMatchObject([
      { attempt: 1, status: "failed" },
      { attempt: 2, status: "succeeded" },
    ]);
    expect(await resources.markedCount(tenant.id)).toStrictEqual({ databases: 1, roles: 1 });
    expect((await audits(tenant.id)).map((row) => `${row.action}:${row.actor_type}`)).toStrictEqual([
      "tenant.provisioning_started:super_admin",
      "tenant.provisioning_failed:system",
      "tenant.provisioning_retried:system",
      "tenant.provisioned:system",
    ]);
  });

  it("reconciles new release migrations after an earlier completed migration step", SLOW, async () => {
    const tenant = await newTenant({ label: "release" });
    const first = await run(tenant.id, OWNER, { hooks: { beforeStep(step) {
      if (step === "verify") throw new Error("simulated late setup failure");
    } } });
    expect(first).toMatchObject({ status: "failed" });
    expect(await completedSteps(tenant.id)).toContain("apply_migrations");
    const deployed = await tenantMigrations.readTenantMigrations();
    const sql = "CREATE TABLE audit_retry_release (id integer PRIMARY KEY);";
    const added: TenantMigration = { name: "20990101000000_audit_retry", sql,
      checksum: createHash("sha256").update(sql).digest("hex") };
    const spy = vi.spyOn(tenantMigrations, "readTenantMigrations").mockResolvedValue([...deployed, added]);
    const retrySteps: ProvisioningStep[] = [];
    try {
      expect(await run(tenant.id, SYSTEM, { hooks: { beforeStep(step) { retrySteps.push(step); } } }))
        .toStrictEqual({ status: "succeeded" });
      expect(retrySteps).toStrictEqual(["apply_migrations", "verify"]);
      expect(await tenantRow(tenant.id)).toMatchObject({ schema_status: "current", schema_version: added.name });
      expect(await resources.queryIn(tenant.database, "SELECT to_regclass('audit_retry_release') IS NOT NULL AS present"))
        .toMatchObject([{ present: true }]);
    } finally {
      spy.mockRestore();
    }
  });

});

describe("concurrency", () => {
  it("answers already_running while another run holds the tenant's lock", SLOW, async () => {
    const tenant = await newTenant({ label: "lock" });
    let entered!: () => void;
    const enteredFirstStep = new Promise<void>((resolve) => (entered = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const first = run(tenant.id, OWNER, {
      hooks: {
        async beforeStep(step) {
          if (step === "create_database_user") {
            entered();
            await gate;
          }
        },
      },
    });
    await Promise.race([
      enteredFirstStep,
      first.then((outcome) => {
        throw new Error(`the first run ended early: ${JSON.stringify(outcome)}`);
      }),
    ]);

    expect(await isProvisioningRunning(tenant.id)).toBe(true);
    expect(await run(tenant.id, OWNER)).toStrictEqual({ status: "already_running" });
    release();
    expect(await first).toStrictEqual({ status: "succeeded" });
    expect(await isProvisioningRunning(tenant.id)).toBe(false);
    expect(await runs(tenant.id)).toHaveLength(1);
  });

  it("lets exactly one of two simultaneous runs provision the tenant", SLOW, async () => {
    const tenant = await newTenant({ label: "race" });
    const outcomes = await Promise.all([run(tenant.id, OWNER), run(tenant.id, OWNER)]);
    expect(outcomes.filter((outcome) => outcome.status === "succeeded")).toHaveLength(1);
    const other = outcomes.find((outcome) => outcome.status !== "succeeded");
    // The loser either found the lock taken or, if it came late, the tenant already active.
    expect(["already_running", "invalid_state"]).toContain(other?.status);
    expect(await runs(tenant.id)).toHaveLength(1);
    expect(await resources.markedCount(tenant.id)).toStrictEqual({ databases: 1, roles: 1 });
  });
});

describe("crash recovery", () => {
  it("marks a run left `running` without a lock holder as interrupted and finishes in a new attempt", SLOW, async () => {
    const tenant = await newTenant({ label: "stale", status: "provisioning" });
    await db.query(
      `INSERT INTO tenant_provisioning_runs (id, tenant_id, attempt, status, step)
       VALUES ($1, $2, 1, 'running', 'create_database_user')`,
      [randomUUID(), tenant.id],
    );
    expect(await isProvisioningRunning(tenant.id)).toBe(false);

    expect(await run(tenant.id, SYSTEM)).toStrictEqual({ status: "succeeded" });
    const rows = await runs(tenant.id);
    expect(rows).toMatchObject([
      { attempt: 1, status: "failed", error_code: "interrupted", step: "create_database_user" },
      { attempt: 2, status: "succeeded" },
    ]);
    expect(rows[0]?.finished_at).toBeInstanceOf(Date);
    expect((await audits(tenant.id)).map((row) => row.action)).toStrictEqual([
      "tenant.provisioning_retried",
      "tenant.provisioned",
    ]);
  });
});

// ---------------------------------------------------------------------------

describe("name conflicts", () => {
  async function roleState(name: string) {
    const result = await db.query(
      `SELECT rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolconnlimit, rolpassword,
              shobj_description(oid, 'pg_authid') AS comment
       FROM pg_authid WHERE rolname = $1`,
      [name],
    );
    return result.rows[0];
  }

  it("refuses a role of the same name that is not the tenant's, and leaves it untouched", SLOW, async () => {
    const tenant = await newTenant({ label: "frole" });
    const foreignPassword = "vt-foreign-role-password-0123456789";
    secrets.add(foreignPassword);
    // Marked, but for another tenant: still not ours.
    await resources.createRole(tenant.user, foreignPassword, {
      comment: `md-tenant:${randomUUID()}`,
    });
    const before = await roleState(tenant.user);

    const outcome = await run(tenant.id);
    expect(outcome).toMatchObject({ status: "failed", code: "resource_conflict" });
    expect(outcome.status === "failed" && outcome.message).toContain(tenant.user);
    expect(await roleState(tenant.user)).toStrictEqual(before);
    expect(await databaseExists(tenant.database, tenant.port)).toBe(false);
    expect(await tenantRow(tenant.id)).toMatchObject({ status: "failed" });
  });

  it("refuses an unmarked database of the same name when no attempt stopped while creating it", SLOW, async () => {
    const tenant = await newTenant({ label: "fdb" });
    await resources.createDatabase(tenant.database);

    const outcome = await run(tenant.id);
    expect(outcome).toMatchObject({ status: "failed", code: "resource_conflict" });
    expect(outcome.status === "failed" && outcome.message).toContain(tenant.database);
    expect(await resources.comment("database", tenant.database)).toBeNull();
    expect(await runs(tenant.id)).toMatchObject([{ status: "failed", step: "create_database" }]);
  });

  it("adopts the empty database an interrupted attempt created but did not mark", SLOW, async () => {
    const tenant = await newTenant({ label: "adopt", status: "provisioning" });
    // The crash window: CREATE DATABASE done, COMMENT not yet, process gone.
    await db.query(
      `INSERT INTO tenant_provisioning_runs (id, tenant_id, attempt, status, step)
       VALUES ($1, $2, 1, 'running', 'create_database')`,
      [randomUUID(), tenant.id],
    );
    await resources.createDatabase(tenant.database);

    expect(await run(tenant.id, SYSTEM)).toStrictEqual({ status: "succeeded" });
    expect(await resources.comment("database", tenant.database)).toBe(`md-tenant:${tenant.id}`);
    expect(await resources.markedCount(tenant.id)).toStrictEqual({ databases: 1, roles: 1 });
    expect(await runs(tenant.id)).toMatchObject([
      { attempt: 1, status: "failed", error_code: "interrupted", step: "create_database" },
      { attempt: 2, status: "succeeded" },
    ]);
  });

  it("does not adopt such a database once something was put in it", SLOW, async () => {
    const tenant = await newTenant({ label: "noadopt", status: "provisioning" });
    await db.query(
      `INSERT INTO tenant_provisioning_runs (id, tenant_id, attempt, status, step)
       VALUES ($1, $2, 1, 'running', 'create_database')`,
      [randomUUID(), tenant.id],
    );
    await resources.createDatabase(tenant.database);
    await resources.queryIn(tenant.database, "CREATE TABLE someone_elses (id integer)");

    expect(await run(tenant.id, SYSTEM)).toMatchObject({ status: "failed", code: "resource_conflict" });
    expect(await resources.comment("database", tenant.database)).toBeNull();
    expect(
      await resources.queryIn(tenant.database, "SELECT to_regclass('public.someone_elses') IS NOT NULL AS present"),
    ).toStrictEqual([{ present: true }]);
  });
});

// ---------------------------------------------------------------------------

describe("existing database mode", () => {
  const rolePassword = "vt-existing-role-password-0123456789";

  /** A login role and an empty database the "customer" made, as the test's own. */
  async function customerDatabase(label: string, roleAttributes = "") {
    const names = testIdentifiers(label);
    await resources.createRole(names.user, rolePassword, { attributes: roleAttributes });
    await resources.createDatabase(names.database);
    return { ...names, password: rolePassword, port: postgresPort() };
  }

  beforeAll(() => {
    secrets.add(rolePassword);
  });

  it("accepts an empty database with its own login and provisions it", SLOW, async () => {
    const login = await customerDatabase("exok");
    const tenant = await newTenant({
      label: "exok",
      mode: "existing",
      database: login.database,
      user: login.user,
      databasePassword: rolePassword,
    });

    const result = await checkExistingDatabase(login, { excludeTenantId: tenant.id });
    observed.push(result);
    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => [check.id, check.status])).toStrictEqual([
      ["connection", "pass"],
      ["role", "pass"],
      ["availability", "pass"],
      ["contents", "pass"],
      ["admin_access", "pass"],
    ]);
    // Without excluding the tenant itself, its own row is "another tenant".
    const unexcluded = await checkExistingDatabase(login);
    observed.push(unexcluded);
    expect(unexcluded.checks.find((check) => check.id === "availability")?.status).toBe("fail");

    expect(await run(tenant.id)).toStrictEqual({ status: "succeeded" });
    expect(await completedSteps(tenant.id)).toStrictEqual([...provisioningPlan("existing")].sort());
    expect(await tenantRow(tenant.id)).toMatchObject({ status: "active", schema_status: "current" });
    const client = await connectAs(login);
    try {
      const users = await client.query("SELECT username FROM users");
      expect(users.rows).toStrictEqual([{ username: tenant.adminUsername }]);
    } finally {
      await client.end();
    }
    // Attached, not created: no ownership marker was added to the customer's objects.
    expect(await resources.comment("database", login.database)).toBeNull();
    expect(await resources.comment("role", login.user)).toBeNull();

    // Attached again (e.g. after a re-create), it is recognised as this platform's schema.
    const again = await checkExistingDatabase(login, { excludeTenantId: tenant.id });
    observed.push(again);
    expect(again.checks.find((check) => check.id === "contents")).toMatchObject({
      status: "pass",
      message: expect.stringMatching(/up to date/),
    });
  });

  it("reports invalid connection details as one failing check, without connecting", async () => {
    const result = await checkExistingDatabase({
      database: "Not-A-Name",
      user: "t_test_whatever_app",
      password: "x",
      port: postgresPort(),
    });
    observed.push(result);
    expect(result.ok).toBe(false);
    expect(result.checks).toMatchObject([{ id: "input", status: "fail" }]);
  });

  it("warns about a role that can create databases, without blocking", async () => {
    const login = await customerDatabase("exwarn", "CREATEDB");
    const result = await checkExistingDatabase(login);
    observed.push(result);
    expect(result.ok).toBe(true);
    expect(result.checks.find((check) => check.id === "role")).toMatchObject({
      status: "warn",
      message: expect.stringContaining("CREATEDB"),
    });
  });

  it("rejects a wrong password with a clear message", SLOW, async () => {
    const login = await customerDatabase("exbadpw");
    const wrongPassword = "vt-wrong-password-0123456789";
    secrets.add(wrongPassword);

    const result = await checkExistingDatabase({ ...login, password: wrongPassword });
    observed.push(result);
    expect(result.ok).toBe(false);
    const connection = result.checks.find((check) => check.id === "connection");
    expect(connection?.status).toBe("fail");
    expect(connection?.message).toContain(login.user);
    expect(connection?.message).toMatch(/password/);

    const tenant = await newTenant({
      label: "exbadpw",
      mode: "existing",
      database: login.database,
      user: login.user,
      databasePassword: wrongPassword,
    });
    const outcome = await run(tenant.id);
    expect(outcome).toMatchObject({ status: "failed", code: "auth_failed" });
    expect(outcome.status === "failed" && outcome.message).toMatch(/password/);
    expect(await runs(tenant.id)).toMatchObject([{ status: "failed", step: "check_database", error_code: "auth_failed" }]);
    // Nothing was installed.
    expect(
      await resources.queryIn(login.database, "SELECT to_regclass('public._prisma_migrations') IS NULL AS absent"),
    ).toStrictEqual([{ absent: true }]);
  });

  it("rejects the administrative (superuser) login", async () => {
    const login = await customerDatabase("exsuper");
    const result = await checkExistingDatabase({
      database: login.database,
      user: ADMIN_LOGIN,
      password: process.env.POSTGRES_PASSWORD ?? "",
      port: login.port,
    });
    observed.push(result);
    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.id === "role")).toMatchObject({
      status: "fail",
      message: expect.stringContaining("administrative login"),
    });
  });

  it("rejects a database with someone else's tables and leaves them untouched", SLOW, async () => {
    const login = await customerDatabase("exforeign");
    await resources.queryIn(
      login.database,
      "CREATE TABLE foreign_data (id integer); INSERT INTO foreign_data VALUES (42)",
    );
    const aclBefore = await resources.queryIn(
      login.database,
      "SELECT nspacl::text AS acl FROM pg_namespace WHERE nspname = 'public'",
    );

    const result = await checkExistingDatabase(login);
    observed.push(result);
    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.id === "contents")).toMatchObject({
      status: "fail",
      message: expect.stringContaining("will not be modified"),
    });

    const tenant = await newTenant({
      label: "exforeign",
      mode: "existing",
      database: login.database,
      user: login.user,
      databasePassword: rolePassword,
    });
    expect(await run(tenant.id)).toMatchObject({ status: "failed", code: "resource_conflict" });
    expect(await resources.queryIn(login.database, "SELECT id FROM foreign_data")).toStrictEqual([{ id: 42 }]);
    expect(
      await resources.queryIn(
        login.database,
        "SELECT to_regclass('public._prisma_migrations') IS NULL AS absent, to_regclass('public.users') IS NULL AS no_users",
      ),
    ).toStrictEqual([{ absent: true, no_users: true }]);
    expect(
      await resources.queryIn(login.database, "SELECT nspacl::text AS acl FROM pg_namespace WHERE nspname = 'public'"),
    ).toStrictEqual(aclBefore);
  });
});

// ---------------------------------------------------------------------------

describe("the migration applier", () => {
  const migration = (name: string, sql: string): TenantMigration => ({
    name,
    sql,
    checksum: createHash("sha256").update(sql).digest("hex"),
  });

  type BookkeepingRow = {
    migration_name: string;
    finished: boolean;
    rolled_back: boolean;
    applied_steps_count: number;
    logs: string | null;
  };

  async function bookkeeping(client: Client): Promise<BookkeepingRow[]> {
    const result = await client.query<BookkeepingRow>(
      `SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back,
              applied_steps_count, logs
       FROM "_prisma_migrations" ORDER BY started_at, migration_name`,
    );
    return result.rows;
  }

  it("applies each migration atomically, records a failure as rolled back and converges", SLOW, async () => {
    const { database } = testIdentifiers("applier");
    await resources.createDatabase(database);
    const client = await connectTo(database);
    try {
      const first = migration("001_a", "CREATE TABLE a (id integer);");
      const broken = migration("002_b", "CREATE TABLE b (id integer); SELECT * FROM vt_missing_table;");
      await expect(applyTenantMigrations(client, [first, broken])).rejects.toMatchObject({
        code: "schema_mismatch",
      });
      const tables = await client.query(
        "SELECT to_regclass('public.a') IS NOT NULL AS a, to_regclass('public.b') IS NOT NULL AS b",
      );
      // 002_b's first statement was rolled back with the rest of it.
      expect(tables.rows).toStrictEqual([{ a: true, b: false }]);
      const afterFailure = await bookkeeping(client);
      expect(afterFailure).toMatchObject([
        { migration_name: "001_a", finished: true, rolled_back: false, applied_steps_count: 1 },
        { migration_name: "002_b", finished: false, rolled_back: true, applied_steps_count: 0 },
      ]);
      expect(afterFailure[1]?.logs).toContain("vt_missing_table");

      const fixed = migration("002_b", "CREATE TABLE b (id integer);");
      expect(await applyTenantMigrations(client, [first, fixed])).toStrictEqual(["002_b"]);
      expect(await applyTenantMigrations(client, [first, fixed])).toStrictEqual([]);

      // A changed file, an applied migration this platform lacks, and a failed
      // migration nobody rolled back are all refused.
      await expect(
        applyTenantMigrations(client, [migration("001_a", "CREATE TABLE a (id bigint);"), fixed]),
      ).rejects.toMatchObject({ code: "schema_mismatch" });
      await expect(applyTenantMigrations(client, [first])).rejects.toMatchObject({
        code: "schema_mismatch",
      });
      const third = migration("003_c", "CREATE TABLE c (id integer);");
      await client.query(
        `INSERT INTO "_prisma_migrations" (id, checksum, migration_name) VALUES ($1, $2, $3)`,
        [randomUUID(), third.checksum, third.name],
      );
      await expect(applyTenantMigrations(client, [first, fixed, third])).rejects.toMatchObject({
        code: "schema_mismatch",
      });

      // Prisma's migration lock is never left held.
      const locks = await client.query(
        `SELECT 1 FROM pg_locks
         WHERE locktype = 'advisory' AND objid = $1 AND objsubid = 1 AND pid = pg_backend_pid()`,
        [PRISMA_MIGRATION_LOCK_ID],
      );
      expect(locks.rowCount).toBe(0);
    } finally {
      await client.end();
    }
  });
});

// ---------------------------------------------------------------------------

describe("secrets", () => {
  it("never appear in an outcome, a check result or the console", () => {
    expect(observed.length).toBeGreaterThan(10);
    const visible = `${JSON.stringify(observed)}\n${consoleOutput.text()}`;
    // The log is not empty: the runner reported its steps.
    expect(consoleOutput.text()).toContain("[provisioning] tenant");
    for (const secret of secrets) {
      expect(visible.includes(secret), "a secret was exposed").toBe(false);
    }
  });
});

describe("teardown", () => {
  it("drops every database and role this file created, and nothing else", SLOW, async () => {
    const dropped = await resources.cleanup();
    expect(dropped.databases.length).toBeGreaterThan(5);
    expect(dropped.databases.every((name) => name.startsWith("t_test_"))).toBe(true);
    expect(dropped.roles.every((name) => name.startsWith("t_test_"))).toBe(true);
    expect(await resources.inventory()).toStrictEqual(inventoryBefore);
  });
});

import { createHash, randomUUID } from "node:crypto";
import { Client, type ClientConfig } from "pg";
import { assertTestDatabaseName, TEST_DATABASE_SUFFIX } from "./database-name";

/** Exists in every PostgreSQL cluster; only used to issue CREATE / DROP DATABASE. */
const MAINTENANCE_DATABASE = "postgres";

function clientConfig(database: string): ClientConfig {
  const host = process.env.POSTGRES_HOST?.trim();
  const user = process.env.POSTGRES_USER?.trim();
  const password = process.env.POSTGRES_PASSWORD?.trim();
  if (!host || !user || !password) {
    throw new Error("POSTGRES_HOST, POSTGRES_USER and POSTGRES_PASSWORD must be set");
  }
  return {
    host,
    port: Number(process.env.POSTGRES_PORT?.trim() || "5432"),
    user,
    password,
    database,
    connectionTimeoutMillis: 5_000,
  };
}

/** A direct connection, independent of the application's pool. */
export async function connectTo(database: string): Promise<Client> {
  const client = new Client(clientConfig(database));
  // A dropped connection must not crash the test process.
  client.on("error", () => undefined);
  await client.connect();
  return client;
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Drops a scratch database, ending any connection left open to it. Refuses any other name. */
export async function dropTestDatabase(name: string): Promise<void> {
  assertTestDatabaseName(name);
  const admin = await connectTo(MAINTENANCE_DATABASE);
  try {
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [name],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

export async function createTestDatabase(name: string): Promise<void> {
  assertTestDatabaseName(name);
  const admin = await connectTo(MAINTENANCE_DATABASE);
  try {
    await admin.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
  } finally {
    await admin.end();
  }
}

/** The scratch database of this run (see tests/support/setup-env.ts). */
export async function connectToTestDatabase(): Promise<Client> {
  const name = process.env.PLATFORM_TEST_DATABASE ?? "";
  assertTestDatabaseName(name);
  return connectTo(name);
}

/**
 * Empties the two platform owner tables, the custom platform roles (the
 * Master Platform role written by the migration stays) and the platform
 * module switches. Only ever in a scratch database: the server is asked which
 * database this connection is on before anything is deleted.
 */
export async function clearPlatformTables(db: Client): Promise<void> {
  const current = await db.query<{ name: string }>("SELECT current_database() AS name");
  const name = current.rows[0]?.name ?? "";
  if (!name.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new Error("refusing to clear tables outside the test database");
  }
  await db.query("DELETE FROM platform_owner_sessions");
  await db.query("DELETE FROM platform_owners");
  await db.query("DELETE FROM platform_roles WHERE system_key IS NULL");
  await db.query("DELETE FROM platform_module_settings");
}

/**
 * Empties the tenant tables (and `secrets`, which only tenants use so far).
 * Only ever in a scratch database, checked as in clearPlatformTables. Audit
 * events are kept: nothing references them.
 */
export async function clearTenantTables(db: Client): Promise<void> {
  const current = await db.query<{ name: string }>("SELECT current_database() AS name");
  const name = current.rows[0]?.name ?? "";
  if (!name.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new Error("refusing to clear tables outside the test database");
  }
  await db.query("DELETE FROM tenant_provisioning_steps");
  await db.query("DELETE FROM tenant_provisioning_runs");
  await db.query("DELETE FROM tenant_domains");
  await db.query("DELETE FROM tenants");
  await db.query("DELETE FROM secrets");
}

/**
 * Inserts a tenant on the default plan with only the required columns set,
 * plus any of the optional ones given. Returns its id.
 */
export async function insertTenant(
  db: Client,
  tenant: {
    slug: string;
    contactEmail?: string;
    adminUsername?: string;
    phone?: string | null;
    databaseName?: string | null;
    databaseUser?: string | null;
    databasePort?: number | null;
    databaseSecretRef?: string | null;
  },
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO tenants (id, name, slug, contact_email, admin_username, plan_id, phone,
                          database_name, database_user, database_port, database_secret_ref)
     VALUES ($1, $2, $3, $4, $5, (SELECT id FROM plans WHERE is_default LIMIT 1), $6, $7, $8, $9, $10)`,
    [
      id,
      `Test ${tenant.slug}`,
      tenant.slug,
      tenant.contactEmail ?? `${tenant.slug}@example.com`,
      tenant.adminUsername ?? tenant.slug,
      tenant.phone ?? null,
      tenant.databaseName ?? null,
      tenant.databaseUser ?? null,
      tenant.databasePort ?? null,
      tenant.databaseSecretRef ?? null,
    ],
  );
  return id;
}

export type OwnerRow = {
  id: string;
  username: string;
  password_hash: string;
  status: string;
  created_at: Date;
  updated_at: Date;
};

export type SessionRow = {
  id: string;
  owner_id: string;
  token_hash: string;
  created_at: Date;
  last_used_at: Date;
  expires_at: Date;
};

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** The id of the Master Platform role (found by its system key, as the app does). */
export async function masterPlatformRoleId(db: Client): Promise<string> {
  const result = await db.query<{ id: string }>("SELECT id FROM platform_roles WHERE system_key = 'master_platform'");
  const id = result.rows[0]?.id;
  if (!id) throw new Error("the Master Platform role is missing: are the migrations applied?");
  return id;
}

/**
 * Inserts a platform owner. Every owner holds exactly one role: the Master
 * Platform role unless `roleId` names another (custom) platform role.
 */
export async function insertOwner(
  db: Client,
  owner: { username: string; passwordHash: string; status?: "active" | "disabled"; roleId?: string },
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO platform_owners (id, username, password_hash, status, role_id)
     VALUES ($1, $2, $3, $4::platform_owner_status,
             COALESCE($5::uuid, (SELECT id FROM platform_roles WHERE system_key = 'master_platform')))`,
    [id, owner.username, owner.passwordHash, owner.status ?? "active", owner.roleId ?? null],
  );
  return id;
}

/**
 * Inserts a custom platform role holding exactly the given privilege keys
 * (they must exist in platform_permissions). Returns its id.
 */
export async function insertPlatformRole(
  db: Client,
  role: { name: string; permissionKeys: readonly string[]; status?: "active" | "disabled" },
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO platform_roles (id, name, status, updated_at) VALUES ($1, $2, $3::role_status, now())`,
    [id, role.name, role.status ?? "active"],
  );
  for (const key of role.permissionKeys) {
    await db.query("INSERT INTO platform_role_permissions (role_id, permission_key) VALUES ($1, $2)", [id, key]);
  }
  return id;
}

/**
 * Inserts a session row directly. The ages are in minutes relative to the
 * database clock; by default the session is fresh and has hours left.
 */
export async function insertSession(
  db: Client,
  session: {
    ownerId: string;
    tokenHash?: string;
    lastUsedMinutesAgo?: number;
    expiresInMinutes?: number;
  },
): Promise<SessionRow> {
  const result = await db.query<SessionRow>(
    `INSERT INTO platform_owner_sessions (id, owner_id, token_hash, last_used_at, expires_at)
     VALUES ($1, $2, $3, now() - make_interval(secs => $4::double precision * 60),
             now() + make_interval(secs => $5::double precision * 60))
     RETURNING *`,
    [
      randomUUID(),
      session.ownerId,
      session.tokenHash ?? sha256Hex(randomUUID()),
      session.lastUsedMinutesAgo ?? 0,
      session.expiresInMinutes ?? 240,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("the session row was not inserted");
  return row;
}

export async function listOwners(db: Client): Promise<OwnerRow[]> {
  return (await db.query<OwnerRow>("SELECT * FROM platform_owners ORDER BY created_at, id")).rows;
}

/** All sessions, or those of one owner. */
export async function listSessions(db: Client, ownerId?: string): Promise<SessionRow[]> {
  const result = ownerId
    ? await db.query<SessionRow>(
        "SELECT * FROM platform_owner_sessions WHERE owner_id = $1 ORDER BY created_at, id",
        [ownerId],
      )
    : await db.query<SessionRow>("SELECT * FROM platform_owner_sessions ORDER BY created_at, id");
  return result.rows;
}

export async function findSession(db: Client, tokenHash: string): Promise<SessionRow | undefined> {
  const result = await db.query<SessionRow>(
    "SELECT * FROM platform_owner_sessions WHERE token_hash = $1",
    [tokenHash],
  );
  return result.rows[0];
}

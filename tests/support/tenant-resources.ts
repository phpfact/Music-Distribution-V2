/**
 * Tenants for the provisioning tests, and the PostgreSQL objects they cause.
 *
 * The tests use the real dev PostgreSQL server, where other databases and
 * roles live. So every name here starts with `t_test_`, and the teardown drops
 * exactly two kinds of objects:
 *   - a database or role created by provisioning: `t_test_` prefix AND the
 *     ownership marker (`md-tenant:<id>`) of a tenant in the scratch control DB;
 *   - one the test created by hand, which it registered here when creating it.
 * Nothing else is ever dropped.
 */
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { Client, escapeIdentifier, escapeLiteral } from "pg";
import { getControlDb } from "@/lib/db/control";
import { hashPassword } from "@/lib/platform-auth/password";
import { scramSha256Verifier } from "@/lib/provisioning/scram";
import { createSecret } from "@/lib/secrets";
import { TEST_DATABASE_SUFFIX } from "./database-name";
import { connectTo } from "./postgres";

const TEST_NAME_PATTERN = /^t_test_[a-z0-9_]+$/;
const LOWER_ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";

function assertTestName(name: string): void {
  if (!TEST_NAME_PATTERN.test(name) || name.length > 63) {
    throw new Error(`refusing to manage "${name}": test databases and roles are named t_test_...`);
  }
}

export function randomLabel(length = 6): string {
  let text = "";
  for (let i = 0; i < length; i += 1) text += LOWER_ALNUM[randomInt(LOWER_ALNUM.length)];
  return text;
}

const LOWER_LETTERS = "abcdefghijklmnopqrstuvwxyz";

/**
 * Random lower-case letters: tenant full names allow letters, spaces and
 * . ' - & only (no digits), so names built for tests use this, not randomLabel.
 */
export function randomLetters(length = 6): string {
  let text = "";
  for (let i = 0; i < length; i += 1) text += LOWER_LETTERS[randomInt(LOWER_LETTERS.length)];
  return text;
}

/** A valid tenant full name for a test: "Test <label as words> <random letters>". */
export function testTenantName(label: string): string {
  const words = label.replace(/[^a-z]+/gi, " ").trim();
  return `Test ${words} ${randomLetters(6)}`;
}

/** `t_test_<label>_<random>` and `<that>_app`. */
export function testIdentifiers(label: string): { database: string; user: string } {
  const database = `t_test_${label}_${randomLabel()}`;
  assertTestName(database);
  return { database, user: `${database}_app` };
}

export function postgresPort(): number {
  return Number(process.env.POSTGRES_PORT?.trim() || "5432");
}

export type TestLogin = { database: string; user: string; password: string; port: number };

/** A direct connection with the given login (not the admin's). */
export async function connectAs(login: TestLogin): Promise<Client> {
  const client = new Client({
    host: process.env.POSTGRES_HOST?.trim(),
    port: login.port,
    database: login.database,
    user: login.user,
    password: login.password,
    connectionTimeoutMillis: 5_000,
  });
  client.on("error", () => undefined);
  await client.connect();
  return client;
}

/** The error a connection attempt with this login fails with, or null if it succeeds. */
export async function connectionFailure(login: TestLogin): Promise<{ code?: string } | null> {
  try {
    const client = await connectAs(login);
    await client.end();
    return null;
  } catch (error) {
    return error as { code?: string };
  }
}

export type TestTenant = {
  id: string;
  slug: string;
  name: string;
  adminUsername: string;
  email: string;
  database: string;
  user: string;
  port: number;
  databasePassword: string;
  adminPassword: string;
  pendingHash: string;
};

/**
 * Inserts a tenant as the tenant service will: database names, port, an
 * encrypted database password, the Argon2id hash of the admin password and the
 * subdomain row. No database objects are created.
 */
export async function insertProvisioningTenant(
  db: Client,
  options: {
    label: string;
    mode?: "provisioned" | "existing";
    status?: "pending" | "provisioning" | "failed" | "active" | "suspended";
    database?: string;
    user?: string;
    databasePassword?: string;
  },
): Promise<TestTenant> {
  const suffix = randomLabel(4);
  const slug = `test-${options.label}-${suffix}`;
  const names = testIdentifiers(options.label);
  const database = options.database ?? names.database;
  const user = options.user ?? names.user;
  const databasePassword = options.databasePassword ?? randomBytes(32).toString("base64url");
  const adminPassword = `Vt-Admin-${randomBytes(9).toString("base64url")}`;
  const pendingHash = await hashPassword(adminPassword);
  const secretId = await createSecret(getControlDb(), "tenant_database_password", databasePassword);

  const id = randomUUID();
  const tenant: TestTenant = {
    id,
    slug,
    name: `Test ${options.label} ${suffix}`,
    adminUsername: slug,
    email: `${slug}@example.com`,
    database,
    user,
    port: postgresPort(),
    databasePassword,
    adminPassword,
    pendingHash,
  };
  await db.query(
    `INSERT INTO tenants (id, name, slug, status, contact_email, admin_username, plan_id,
                          database_mode, database_name, database_user, database_port,
                          database_secret_ref, pending_admin_password_hash)
     VALUES ($1, $2, $3, $4::tenant_status, $5, $6, (SELECT id FROM plans WHERE is_default LIMIT 1),
             $7::tenant_database_mode, $8, $9, $10, $11, $12)`,
    [
      id,
      tenant.name,
      slug,
      options.status ?? "pending",
      tenant.email,
      tenant.adminUsername,
      options.mode ?? "provisioned",
      database,
      user,
      tenant.port,
      secretId,
      pendingHash,
    ],
  );
  await db.query(
    `INSERT INTO tenant_domains (id, tenant_id, type, hostname) VALUES ($1, $2, 'subdomain', $3)`,
    [randomUUID(), id, slug],
  );
  return tenant;
}

/** Databases and roles of this test file; see the module comment for what is dropped. */
export class TenantResources {
  private readonly databases = new Set<string>();
  private readonly roles = new Set<string>();

  private constructor(
    private readonly admin: Client,
    private readonly control: Client,
  ) {}

  /** `control` must be connected to the scratch control-plane database. */
  static async open(control: Client): Promise<TenantResources> {
    return new TenantResources(await connectTo("postgres"), control);
  }

  /** An empty database owned by the administrative login, as the test's own. */
  async createDatabase(name: string): Promise<void> {
    assertTestName(name);
    this.databases.add(name);
    await this.admin.query(`CREATE DATABASE ${escapeIdentifier(name)}`);
  }

  /** A login role with this password (sent as a verifier) and extra attributes. */
  async createRole(
    name: string,
    password: string,
    options: { attributes?: string; comment?: string } = {},
  ): Promise<void> {
    assertTestName(name);
    this.roles.add(name);
    await this.admin.query(
      `CREATE ROLE ${escapeIdentifier(name)} LOGIN PASSWORD ${escapeLiteral(scramSha256Verifier(password))} ${options.attributes ?? ""}`,
    );
    if (options.comment !== undefined) {
      await this.admin.query(
        `COMMENT ON ROLE ${escapeIdentifier(name)} IS ${escapeLiteral(options.comment)}`,
      );
    }
  }

  /** Runs SQL as the administrative login inside one of this file's databases. */
  async queryIn<R extends Record<string, unknown>>(
    database: string,
    sql: string,
    values: unknown[] = [],
  ): Promise<R[]> {
    assertTestName(database);
    const client = await connectTo(database);
    try {
      return (await client.query<R>(sql, values)).rows;
    } finally {
      await client.end();
    }
  }

  /** The comment on a database or role, or undefined when it does not exist. */
  async comment(kind: "database" | "role", name: string): Promise<string | null | undefined> {
    const result =
      kind === "database"
        ? await this.admin.query<{ comment: string | null }>(
            "SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = $1",
            [name],
          )
        : await this.admin.query<{ comment: string | null }>(
            "SELECT shobj_description(oid, 'pg_authid') AS comment FROM pg_roles WHERE rolname = $1",
            [name],
          );
    return result.rows[0] ? result.rows[0].comment : undefined;
  }

  /** How many databases / roles carry this tenant's ownership marker. */
  async markedCount(tenantId: string): Promise<{ databases: number; roles: number }> {
    const marker = `md-tenant:${tenantId}`;
    const databases = await this.admin.query(
      "SELECT 1 FROM pg_database WHERE shobj_description(oid, 'pg_database') = $1",
      [marker],
    );
    const roles = await this.admin.query(
      "SELECT 1 FROM pg_roles WHERE shobj_description(oid, 'pg_authid') = $1",
      [marker],
    );
    return { databases: databases.rowCount ?? 0, roles: roles.rowCount ?? 0 };
  }

  /** Every database and role name on the server (to prove nothing else was touched). */
  async inventory(): Promise<{ databases: string[]; roles: string[] }> {
    const databases = await this.admin.query<{ name: string }>(
      "SELECT datname AS name FROM pg_database ORDER BY 1",
    );
    const roles = await this.admin.query<{ name: string }>(
      "SELECT rolname AS name FROM pg_roles ORDER BY 1",
    );
    return {
      databases: databases.rows.map((row) => row.name),
      roles: roles.rows.map((row) => row.name),
    };
  }

  /** Drops what this file created (see the module comment). Returns the names dropped. */
  async cleanup(): Promise<{ databases: string[]; roles: string[] }> {
    const current = await this.control.query<{ name: string }>("SELECT current_database() AS name");
    if (!current.rows[0]?.name.endsWith(TEST_DATABASE_SUFFIX)) {
      throw new Error("the tenant markers must come from the scratch control database");
    }
    const markers = (
      await this.control.query<{ id: string }>("SELECT id::text AS id FROM tenants")
    ).rows.map((row) => `md-tenant:${row.id}`);

    const markedDatabases = await this.admin.query<{ name: string }>(
      `SELECT datname AS name FROM pg_database
       WHERE datname LIKE 't\\_test\\_%' AND shobj_description(oid, 'pg_database') = ANY($1::text[])`,
      [markers],
    );
    const markedRoles = await this.admin.query<{ name: string }>(
      `SELECT rolname AS name FROM pg_roles
       WHERE rolname LIKE 't\\_test\\_%' AND shobj_description(oid, 'pg_authid') = ANY($1::text[])`,
      [markers],
    );
    const databases = [
      ...new Set([...markedDatabases.rows.map((row) => row.name), ...this.databases]),
    ];
    const roles = [...new Set([...markedRoles.rows.map((row) => row.name), ...this.roles])];

    // Databases first: a role cannot be dropped while it has privileges in one.
    for (const name of databases) {
      assertTestName(name);
      await this.admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [name],
      );
      await this.admin.query(`DROP DATABASE IF EXISTS ${escapeIdentifier(name)} WITH (FORCE)`);
    }
    for (const name of roles) {
      assertTestName(name);
      await this.admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1",
        [name],
      );
      await this.admin.query(`DROP ROLE IF EXISTS ${escapeIdentifier(name)}`);
    }
    this.databases.clear();
    this.roles.clear();
    return { databases, roles };
  }

  async close(): Promise<void> {
    await this.admin.end();
  }
}

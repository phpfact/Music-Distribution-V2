import "server-only";
/**
 * PostgreSQL connections and lookups for provisioning (docs/tenant-management.md §6.1).
 *
 * Every connection here is a short-lived `pg.Client`, never the application's
 * pool: provisioning runs DDL as the administrative login, and a pooled
 * connection could be handed to ordinary queries afterwards. Identifiers are
 * validated by the tenant rules and then quoted; DDL cannot take bind
 * parameters, so literals are escaped. Passwords only ever reach PostgreSQL as
 * SCRAM verifiers.
 */
import { Client, escapeIdentifier, escapeLiteral } from "pg";
import { getEnv } from "../env";
import { type DatabaseIdentifierKind, validateDatabaseIdentifier } from "../tenants/rules";
import { type ConnectionContext, connectionError, ProvisioningError } from "./errors";
import { scramSha256Verifier } from "./scram";

/** Exists in every cluster; used for cluster-level statements (roles, CREATE DATABASE). */
export const MAINTENANCE_DATABASE = "postgres";
const CONNECT_TIMEOUT_MS = 5_000;

/** A login to one database on POSTGRES_HOST. The password is plaintext: never log it. */
export type DatabaseLogin = { database: string; user: string; password: string; port: number };

/** Prefix of the COMMENT that marks a role or database as created for a tenant. */
export const OWNERSHIP_MARKER_PREFIX = "md-tenant:";

export function ownershipMarker(tenantId: string): string {
  return `${OWNERSHIP_MARKER_PREFIX}${tenantId}`;
}

export function adminLoginName(): string {
  return getEnv().postgres.user;
}

async function connect<T>(
  login: DatabaseLogin,
  context: ConnectionContext,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    host: context.host,
    port: login.port,
    database: login.database,
    user: login.user,
    password: login.password,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    application_name: "md-provisioning",
  });
  // A dropped connection then surfaces as the failing query's rejection
  // instead of an unhandled "error" event that would crash the process.
  client.on("error", () => undefined);
  try {
    try {
      await client.connect();
    } catch (error) {
      throw connectionError(error, context);
    }
    return await work(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Runs `work` on a new connection as the administrative login (POSTGRES_USER). */
export function withAdminClient<T>(
  database: string,
  port: number,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const { host, user, password } = getEnv().postgres;
  return connect({ database, user, password, port }, { login: "admin", host, user, database, port }, work);
}

/** Runs `work` on a new connection as a tenant's own login. */
export function withLoginClient<T>(
  login: DatabaseLogin,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const { host } = getEnv().postgres;
  return connect(
    login,
    { login: "tenant", host, user: login.user, database: login.database, port: login.port },
    work,
  );
}

/** Names only the server knows that tenants may never use (rules.ts §4). */
export function reservedDatabaseNames(): string[] {
  const { postgres } = getEnv();
  return [postgres.database, postgres.user];
}

/**
 * Validates a tenant's database or role name with the tenant rules and quotes
 * it for SQL. A stored name that fails the rules is never sent to PostgreSQL.
 */
export function quoteTenantIdentifier(name: string, kind: DatabaseIdentifierKind): string {
  const result = validateDatabaseIdentifier(name, kind, { reservedNames: reservedDatabaseNames() });
  if (!result.ok || result.value !== name) {
    throw new ProvisioningError(
      "invalid_state",
      `The stored ${kind === "database" ? "database name" : "database user"} is not a valid name for this platform.`,
    );
  }
  return escapeIdentifier(name);
}

/** The administrative login, quoted. It comes from the server's configuration, not from input. */
export function quotedAdminLogin(): string {
  return escapeIdentifier(adminLoginName());
}

export function sqlLiteral(value: string): string {
  return escapeLiteral(value);
}

/** `PASSWORD '<verifier>'`: the plaintext never appears in the statement (or the server log). */
export function passwordClause(password: string): string {
  let verifier: string;
  try {
    verifier = scramSha256Verifier(password);
  } catch {
    // Only reachable for a password outside printable ASCII, which the rules reject.
    throw new ProvisioningError(
      "invalid_state",
      "The stored database password uses characters this platform cannot set. Rotate the database password, then retry.",
    );
  }
  return `PASSWORD ${escapeLiteral(verifier)}`;
}

// ---------------------------------------------------------------------------
// Lookups (cluster level, on the maintenance database)

export type RoleInfo = {
  name: string;
  superuser: boolean;
  createdb: boolean;
  createrole: boolean;
  bypassrls: boolean;
  canLogin: boolean;
  /** The role's COMMENT, e.g. the ownership marker. */
  comment: string | null;
};

export type DatabaseInfo = { name: string; owner: string; comment: string | null };

export async function findRoleWith(client: Client, name: string): Promise<RoleInfo | null> {
  const result = await client.query<{
    rolname: string;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolbypassrls: boolean;
    rolcanlogin: boolean;
    comment: string | null;
  }>(
    `SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolcanlogin,
            shobj_description(oid, 'pg_authid') AS comment
     FROM pg_roles WHERE rolname = $1`,
    [name],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    name: row.rolname,
    superuser: row.rolsuper,
    createdb: row.rolcreatedb,
    createrole: row.rolcreaterole,
    bypassrls: row.rolbypassrls,
    canLogin: row.rolcanlogin,
    comment: row.comment,
  };
}

export async function findDatabaseWith(client: Client, name: string): Promise<DatabaseInfo | null> {
  const result = await client.query<{ datname: string; owner: string; comment: string | null }>(
    `SELECT datname, pg_get_userbyid(datdba) AS owner, shobj_description(oid, 'pg_database') AS comment
     FROM pg_database WHERE datname = $1`,
    [name],
  );
  const row = result.rows[0];
  return row ? { name: row.datname, owner: row.owner, comment: row.comment } : null;
}

export function findRole(name: string, port: number): Promise<RoleInfo | null> {
  return withAdminClient(MAINTENANCE_DATABASE, port, (client) => findRoleWith(client, name));
}

export function findDatabase(name: string, port: number): Promise<DatabaseInfo | null> {
  return withAdminClient(MAINTENANCE_DATABASE, port, (client) => findDatabaseWith(client, name));
}

/** Whether a database of this name exists on the server at `port` (creation-time uniqueness check). */
export async function databaseExists(name: string, port: number): Promise<boolean> {
  return (await findDatabase(name, port)) !== null;
}

/**
 * Whether a role of this name exists. Roles are cluster-wide; `port` picks the
 * server and defaults to POSTGRES_PORT.
 */
export async function roleExists(name: string, port: number = getEnv().postgres.port): Promise<boolean> {
  return (await findRole(name, port)) !== null;
}

/**
 * Relations outside the system schemas, e.g. `public.users`. Every schema
 * whose name starts with pg_ is a system one: PostgreSQL forbids that prefix
 * for user schemas.
 */
export async function userRelations(client: Client): Promise<string[]> {
  const result = await client.query<{ name: string }>(
    `SELECT n.nspname || '.' || c.relname AS name
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname <> 'information_schema' AND n.nspname NOT LIKE 'pg\\_%'
     ORDER BY 1`,
  );
  return result.rows.map((row) => row.name);
}

// ---------------------------------------------------------------------------
// Credentials

/**
 * Sets a tenant role's password (as a SCRAM verifier). The caller makes sure
 * the role is the tenant's own, provisioned one.
 */
export async function setRolePassword(role: string, password: string, port: number): Promise<void> {
  const quoted = quoteTenantIdentifier(role, "user");
  const clause = passwordClause(password);
  await withAdminClient(MAINTENANCE_DATABASE, port, async (client) => {
    await client.query(`ALTER ROLE ${quoted} ${clause}`);
  });
}

export type LoginTestResult =
  | { ok: true }
  | { ok: false; code: ProvisioningError["code"]; message: string };

/** Signs in with the given credentials and runs `SELECT 1`. Never throws. */
export async function testDatabaseLogin(login: DatabaseLogin): Promise<LoginTestResult> {
  try {
    await withLoginClient(login, async (client) => {
      await client.query("SELECT 1");
    });
    return { ok: true };
  } catch (error) {
    const failure =
      error instanceof ProvisioningError
        ? error
        : connectionError(error, {
            login: "tenant",
            host: getEnv().postgres.host,
            user: login.user,
            database: login.database,
            port: login.port,
          });
    return { ok: false, code: failure.code, message: failure.safeMessage };
  }
}

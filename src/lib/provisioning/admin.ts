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
const CONNECT_TIMEOUT_MS          = 5_000;

/** A login to one database on POSTGRES_HOST. The password is plaintext: never log it. */
export type DatabaseLogin = { database: string; user: string; password: string; port: number };

/** Prefix of the COMMENT that marks a role or database as created for a tenant. */
export const OWNERSHIP_MARKER_PREFIX = "md-tenant:";

/**
 * Description: Build the COMMENT that marks a role or database as created for a tenant.
 * Input: The tenant id.
 * Output: `md-tenant:<id>`.
 * Use case: Creating a tenant's role and database; adopting them on a retry.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function ownershipMarker(tenantId: string): string {
  return `${OWNERSHIP_MARKER_PREFIX}${tenantId}`;
}

/**
 * Description: Name the platform's administrative PostgreSQL login.
 * Input: None.
 * Output: POSTGRES_USER from the configuration.
 * Use case: Reserved names and quoted SQL.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function adminLoginName(): string {
  return getEnv().postgres.user;
}

/**
 * Description: Run work on a new, short-lived PostgreSQL connection.
 * Input: The login, the connection context (for error messages) and the work.
 * Output: The work's result. A failed connection becomes a ProvisioningError with a
 *   safe message; the connection is always closed; a dropped connection surfaces
 *   as the failing query's rejection instead of crashing the process.
 * Use case: withAdminClient and withLoginClient.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
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

/**
 * Description: Run work as the administrative login (POSTGRES_USER).
 * Input: The database, the port and the work.
 * Output: The work's result (see connect).
 * Use case: Every provisioning step that creates, grants or inspects.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function withAdminClient<T>(
  database: string,
  port: number,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const { host, user, password } = getEnv().postgres;
  return connect({ database, user, password, port }, { login: "admin", host, user, database, port }, work);
}

/**
 * Description: Run work as a tenant's own login.
 * Input: The tenant login (database, user, plaintext password, port) and the work.
 * Output: The work's result (see connect).
 * Use case: Login tests and tenant-admin updates.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
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

/**
 * Description: List names only the server knows that tenants may never use (rules.ts §4).
 * Input: None.
 * Output: The control-plane database name and the administrative login.
 * Use case: Database identifier validation on the server.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function reservedDatabaseNames(): string[] {
  const { postgres } = getEnv();
  return [postgres.database, postgres.user];
}

/**
 * Description: Validate a tenant database/role name and quote it for SQL.
 * Input: The stored name and whether it is a database or a user.
 * Output: The quoted identifier; throws a ProvisioningError for a name that fails
 *   the rules: a stored name that fails them is never sent to PostgreSQL.
 * Use case: Every statement that names a tenant's database or role.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
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

/**
 * Description: Quote the administrative login for SQL.
 * Input: None.
 * Output: The quoted login (from the configuration, not from input).
 * Use case: Grant statements.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function quotedAdminLogin(): string {
  return escapeIdentifier(adminLoginName());
}

/**
 * Description: Quote a text value as an SQL literal.
 * Input: The text.
 * Output: The escaped literal.
 * Use case: COMMENT statements (ownership markers).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function sqlLiteral(value: string): string {
  return escapeLiteral(value);
}

/**
 * Description: Build the PASSWORD clause of CREATE/ALTER ROLE from a SCRAM verifier.
 * Input: The plaintext password.
 * Output: `PASSWORD '<verifier>'`: the plaintext never appears in the statement or
 *   the server log; throws a ProvisioningError for an unusable password.
 * Use case: Creating a tenant role and setting its password.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
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

/**
 * Description: Look up a role's attributes on an open connection.
 * Input: The client and the role name.
 * Output: The role's flags (superuser, create db/role, bypass RLS, login) and
 *   COMMENT, or null when there is no such role.
 * Use case: findRole and the existing-database checks.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
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

/**
 * Description: Look up a database's owner and COMMENT on an open connection.
 * Input: The client and the database name.
 * Output: The database info, or null when there is no such database.
 * Use case: findDatabase and the provisioning steps.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function findDatabaseWith(client: Client, name: string): Promise<DatabaseInfo | null> {
  const result = await client.query<{ datname: string; owner: string; comment: string | null }>(
    `SELECT datname, pg_get_userbyid(datdba) AS owner, shobj_description(oid, 'pg_database') AS comment
     FROM pg_database WHERE datname = $1`,
    [name],
  );
  const row = result.rows[0];
  return row ? { name: row.datname, owner: row.owner, comment: row.comment } : null;
}

/**
 * Description: Look up a role on the server at a port.
 * Input: The role name and the port.
 * Output: The role info, or null.
 * Use case: roleExists and the provisioning steps.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function findRole(name: string, port: number): Promise<RoleInfo | null> {
  return withAdminClient(MAINTENANCE_DATABASE, port, (client) => findRoleWith(client, name));
}

/**
 * Description: Look up a database on the server at a port.
 * Input: The database name and the port.
 * Output: The database info, or null.
 * Use case: databaseExists and the provisioning steps.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function findDatabase(name: string, port: number): Promise<DatabaseInfo | null> {
  return withAdminClient(MAINTENANCE_DATABASE, port, (client) => findDatabaseWith(client, name));
}

/**
 * Description: Tell whether a database of this name exists on the server.
 * Input: The database name and the port.
 * Output: True when it exists.
 * Use case: Creation-time uniqueness checks.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function databaseExists(name: string, port: number): Promise<boolean> {
  return (await findDatabase(name, port)) !== null;
}

/**
 * Description: Tell whether a role of this name exists (roles are cluster-wide).
 * Input: The role name and the port (default POSTGRES_PORT).
 * Output: True when it exists.
 * Use case: Creation-time uniqueness checks.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function roleExists(name: string, port: number = getEnv().postgres.port): Promise<boolean> {
  return (await findRole(name, port)) !== null;
}

/**
 * Description: List the relations outside the system schemas.
 * Input: An open client on the database to inspect.
 * Output: Names like `public.users`; every schema starting with pg_ is a system one
 *   (PostgreSQL forbids that prefix for user schemas).
 * Use case: Existing-database content checks.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
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
 * Description: Set a tenant role's password as a SCRAM verifier.
 * Input: The role, the plaintext password and the port.
 * Output: Nothing; the caller makes sure the role is the tenant's own provisioned one.
 * Use case: Rotate database password.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
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

/**
 * Description: Sign in with the given credentials and run SELECT 1.
 * Input: The login.
 * Output: ok, or the safe ProvisioningError explaining why not. Never throws.
 * Use case: Updating an existing database's password and the existing-database checks.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
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

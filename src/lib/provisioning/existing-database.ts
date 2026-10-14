import "server-only";
/**
 * Checks for attaching a database that already exists (docs/tenant-management.md §6.4).
 *
 * Used by the `check_database` step and by the "Test connection" action
 * (whose caller rate-limits it). Each check opens its own short-lived
 * connection, and only the first one uses the supplied credentials: the
 * others look at the server through the administrative login, so the owner
 * gets every finding at once, even when the password is wrong.
 *
 * Nothing here changes the database.
 */
import { type Client, escapeIdentifier } from "pg";
import { getControlDb } from "../db/control";
import { getEnv } from "../env";
import {
  parsePort,
  validateDatabaseIdentifier,
  validateExistingDatabasePassword,
} from "../tenants/rules";
import {
  adminLoginName,
  type DatabaseLogin,
  findRoleWith,
  MAINTENANCE_DATABASE,
  userRelations,
  withAdminClient,
  withLoginClient,
} from "./admin";
import { describeForLog, ProvisioningError, type ProvisioningErrorCode } from "./errors";
import { planMigrations, readAppliedMigrations, readTenantMigrations } from "./migrations";

export type DatabaseCheck = {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  message: string;
};

/** A check with the error code a failure maps to (for the provisioning step). */
export type DetailedDatabaseCheck = DatabaseCheck & { code?: ProvisioningErrorCode };

const pass = (id: string, label: string, message: string): DetailedDatabaseCheck => ({
  id,
  label,
  status: "pass",
  message,
});

const warn = (id: string, label: string, message: string): DetailedDatabaseCheck => ({
  id,
  label,
  status: "warn",
  message,
});

const fail = (
  id: string,
  label: string,
  code: ProvisioningErrorCode,
  message: string,
): DetailedDatabaseCheck => ({ id, label, status: "fail", message, code });

/** A failed lookup, reported on the check that needed it. The detail goes to the log only. */
function failedLookup(
  id: string,
  label: string,
  error: unknown,
  secrets: readonly string[],
): DetailedDatabaseCheck {
  if (error instanceof ProvisioningError) return fail(id, label, error.code, error.safeMessage);
  console.error(`[provisioning] database check ${id} failed: ${describeForLog(error, secrets)}`);
  return fail(id, label, "internal", "This check could not be completed. Retry; if it fails again, check the server log.");
}

// ---------------------------------------------------------------------------
// 0. The input itself

function validateInput(login: DatabaseLogin): DetailedDatabaseCheck | null {
  const { postgres } = getEnv();
  const label = "Connection details";
  const database = validateDatabaseIdentifier(login.database, "database", {
    reservedNames: [postgres.database, postgres.user],
  });
  if (!database.ok || database.value !== login.database) {
    return fail("input", label, "invalid_state", database.ok ? "Remove the spaces around the database name." : database.error);
  }
  // The administrative login is deliberately not reserved here: check 2 then
  // explains exactly why it cannot be used.
  const user = validateDatabaseIdentifier(login.user, "user", { reservedNames: [postgres.database] });
  if (!user.ok || user.value !== login.user) {
    return fail("input", label, "invalid_state", user.ok ? "Remove the spaces around the database user." : user.error);
  }
  const port = parsePort(login.port, postgres.port);
  if (!port.ok) return fail("input", label, "invalid_state", port.error);
  const password = validateExistingDatabasePassword(login.password);
  if (!password.ok) return fail("input", label, "invalid_state", password.error);
  return null;
}

// ---------------------------------------------------------------------------
// 1. Sign in as the supplied role

async function checkConnection(login: DatabaseLogin, secrets: readonly string[]) {
  const id = "connection";
  const label = `Sign in as ${login.user}`;
  try {
    await withLoginClient(login, async (client) => {
      await client.query("SELECT 1");
    });
    return pass(id, label, `Signed in to database "${login.database}" as "${login.user}".`);
  } catch (error) {
    return failedLookup(id, label, error, secrets);
  }
}

// ---------------------------------------------------------------------------
// 2. The role's attributes

async function checkRole(login: DatabaseLogin, secrets: readonly string[]) {
  const id = "role";
  const label = "Database user privileges";
  if (login.user === adminLoginName()) {
    return fail(
      id,
      label,
      "resource_conflict",
      `"${login.user}" is the platform's administrative login. Give the tenant a role of its own.`,
    );
  }
  try {
    const role = await withAdminClient(MAINTENANCE_DATABASE, login.port, (client) =>
      findRoleWith(client, login.user),
    );
    if (!role) {
      return fail(id, label, "auth_failed", `There is no role named "${login.user}" on this server.`);
    }
    if (role.superuser || role.bypassrls) {
      return fail(
        id,
        label,
        "resource_conflict",
        `"${login.user}" is ${role.superuser ? "a superuser" : "allowed to bypass row-level security"}. Use a role without SUPERUSER and BYPASSRLS: the tenant's login must not be able to reach other tenants' data.`,
      );
    }
    if (role.createdb || role.createrole) {
      const extra = [role.createdb && "CREATEDB", role.createrole && "CREATEROLE"].filter(Boolean);
      return warn(
        id,
        label,
        `"${login.user}" has ${extra.join(" and ")}. It works, but a role without ${extra.length > 1 ? "them" : "it"} is safer.`,
      );
    }
    return pass(id, label, `"${login.user}" is not a superuser and cannot bypass row-level security.`);
  } catch (error) {
    return failedLookup(id, label, error, secrets);
  }
}

// ---------------------------------------------------------------------------
// 3. Not used by another tenant

async function checkAvailability(
  login: DatabaseLogin,
  excludeTenantId: string | undefined,
  secrets: readonly string[],
) {
  const id = "availability";
  const label = "Not used by another tenant";
  try {
    const others = await getControlDb().tenant.findMany({
      where: {
        OR: [{ databaseName: login.database }, { databaseUser: login.user }],
        ...(excludeTenantId ? { NOT: { id: excludeTenantId } } : {}),
      },
      select: { databaseName: true, databaseUser: true },
      take: 2,
    });
    if (others.some((tenant) => tenant.databaseName === login.database)) {
      return fail(id, label, "resource_conflict", `Database "${login.database}" is already used by another tenant.`);
    }
    if (others.some((tenant) => tenant.databaseUser === login.user)) {
      return fail(id, label, "resource_conflict", `Database user "${login.user}" is already used by another tenant.`);
    }
    return pass(id, label, "Neither the database nor the user belongs to another tenant.");
  } catch (error) {
    return failedLookup(id, label, error, secrets);
  }
}

// ---------------------------------------------------------------------------
// 4. What the database already contains

const NOT_OURS =
  "The database is not empty and does not hold this platform's schema. It will not be modified: choose an empty database.";

async function inspectContents(client: Client) {
  const id = "contents";
  const label = "Database contents";
  const relations = await userRelations(client);
  if (relations.length === 0) {
    return pass(id, label, "The database is empty. The schema will be installed.");
  }
  const rows = await readAppliedMigrations(client);
  if (rows === null) return fail(id, label, "resource_conflict", NOT_OURS);

  const plan = planMigrations(await readTenantMigrations(), rows);
  if (!plan.ok) {
    return fail(id, label, "schema_mismatch", `${plan.problem} The database will not be modified.`);
  }
  // Bookkeeping without any applied migration next to other tables is
  // somebody else's schema, not a fresh one of ours.
  if (plan.applied.length === 0 && relations.some((name) => name !== "public._prisma_migrations")) {
    return fail(id, label, "resource_conflict", NOT_OURS);
  }
  const pending = plan.pending.length;
  return pass(
    id,
    label,
    pending === 0
      ? "The database already holds this platform's schema, up to date."
      : `The database holds this platform's schema; ${pending} pending migration${pending === 1 ? "" : "s"} will be applied.`,
  );
}

async function checkContents(login: DatabaseLogin, secrets: readonly string[]) {
  try {
    return await withAdminClient(login.database, login.port, inspectContents);
  } catch (error) {
    return failedLookup("contents", "Database contents", error, secrets);
  }
}

// ---------------------------------------------------------------------------
// 5. The administrative login can install the schema

async function checkAdminAccess(login: DatabaseLogin, secrets: readonly string[]) {
  const id = "admin_access";
  const label = "Platform access for schema changes";
  const admin = escapeIdentifier(adminLoginName());
  const database = escapeIdentifier(login.database);
  try {
    return await withAdminClient(login.database, login.port, async (client) => {
      const result = await client.query<{ superuser: boolean; has_public: boolean; can_create: boolean }>(
        `SELECT r.rolsuper AS superuser,
                n.oid IS NOT NULL AS has_public,
                coalesce(has_schema_privilege(n.oid, 'CREATE'), false) AS can_create
         FROM pg_roles r LEFT JOIN pg_namespace n ON n.nspname = 'public'
         WHERE r.rolname = current_user`,
      );
      const row = result.rows[0];
      if (!row?.has_public) {
        return fail(
          id,
          label,
          "permission_denied",
          `Database "${login.database}" has no schema public. As its owner, run: CREATE SCHEMA public; GRANT CREATE ON SCHEMA public TO ${admin};`,
        );
      }
      if (!row.superuser && !row.can_create) {
        return fail(
          id,
          label,
          "permission_denied",
          `The platform's administrative login cannot create tables in schema public of "${login.database}". As the database owner, run: GRANT CREATE ON SCHEMA public TO ${admin};`,
        );
      }
      return pass(id, label, "The platform can install and update the schema in this database.");
    });
  } catch (error) {
    if (error instanceof ProvisioningError && error.code === "permission_denied") {
      return fail(
        id,
        label,
        "permission_denied",
        `The platform's administrative login cannot connect to "${login.database}". As the database owner, run: GRANT CONNECT ON DATABASE ${database} TO ${admin}; and in that database: GRANT CREATE ON SCHEMA public TO ${admin};`,
      );
    }
    return failedLookup(id, label, error, secrets);
  }
}

// ---------------------------------------------------------------------------

/** Every check with the code its failure maps to. */
export async function runDatabaseChecks(
  login: DatabaseLogin,
  options: { excludeTenantId?: string } = {},
): Promise<DetailedDatabaseCheck[]> {
  const invalid = validateInput(login);
  if (invalid) return [invalid];
  const secrets = [login.password];
  // Independent of each other, so they run side by side: an unreachable
  // server then costs one connect timeout, not five.
  return Promise.all([
    checkConnection(login, secrets),
    checkRole(login, secrets),
    checkAvailability(login, options.excludeTenantId, secrets),
    checkContents(login, secrets),
    checkAdminAccess(login, secrets),
  ]);
}

/**
 * The §6.4 checks for attaching an existing database. `ok` is false when any
 * check fails; warnings do not block. `excludeTenantId` is the tenant being
 * checked itself, whose own row holds the same names.
 */
export async function checkExistingDatabase(
  login: DatabaseLogin,
  options: { excludeTenantId?: string } = {},
): Promise<{ ok: boolean; checks: DatabaseCheck[] }> {
  const detailed = await runDatabaseChecks(login, options);
  return {
    ok: detailed.every((check) => check.status !== "fail"),
    checks: detailed.map(({ id, label, status, message }) => ({ id, label, status, message })),
  };
}

import "server-only";
/**
 * Changing a tenant's credentials (docs/tenant-management.md §8.5): the
 * master password of the tenant admin and the password of the tenant's
 * database login. Deliberate, separate actions: each is rate-limited per
 * owner, refused while setup runs, and audited (the mode only, never a value).
 *
 * No result carries a secret, except a generated master password, returned
 * once. Nothing here logs a password: failures are logged through
 * `describeError`, and the statements sent to PostgreSQL carry SCRAM
 * verifiers or bind parameters, never plaintext in their text.
 */
import { recordAudit } from "@/lib/audit";
import { getControlDb } from "@/lib/db/control";
import { evictTenantDb } from "@/lib/db/tenant";
import { hashPassword } from "@/lib/platform-auth/password";
import { describeError } from "@/lib/platform-auth/session";
import { setRolePassword, testDatabaseLogin } from "@/lib/provisioning";
import { consumeRateLimit } from "@/lib/rate-limit";
import { readSecret, replaceSecret } from "@/lib/secrets";
import { generateDatabasePassword, generateMasterPassword } from "@/lib/tenants/generate";
import { validateExistingDatabasePassword, validateMasterPassword } from "@/lib/tenants/rules";
import { isUuid, ownerAudit, type ServiceFailure, type TenantActor, UNAVAILABLE_MESSAGE } from "./common";
import { type AdminRowOutcome, updateTenantAdminRow } from "./tenant-admin";

export type MasterPasswordResetInput = { mode: "auto" } | { mode: "manual"; password: string };

type CredentialFailure = ServiceFailure<
  "not_found" | "invalid_state" | "validation" | "rate_limited" | "unavailable"
>;

export type MasterPasswordResetResult =
  | {
      ok: true;
      /** Auto mode only: shown once, never stored or logged. */
      generatedPassword?: string;
    }
  | CredentialFailure;

/** Database password rotation and update. */
export type CredentialResult = { ok: true } | CredentialFailure;

const NOT_FOUND = { ok: false, reason: "not_found", message: "This tenant does not exist." } as const;
const UNAVAILABLE = { ok: false, reason: "unavailable", message: UNAVAILABLE_MESSAGE } as const;
const BUSY = {
  ok: false,
  reason: "invalid_state",
  message: "Wait until setup finishes before changing credentials.",
} as const;

const CREDENTIAL_LIMIT = { limit: 10, windowSeconds: 15 * 60 };

type CredentialAction = "tenant-admin-password" | "tenant-db-rotate" | "tenant-db-password";

async function limitAction(action: CredentialAction, actor: TenantActor): Promise<CredentialFailure | null> {
  const limit = await consumeRateLimit({ key: `${action}:${actor.ownerId}`, ...CREDENTIAL_LIMIT });
  if (limit === "limited") {
    return {
      ok: false,
      reason: "rate_limited",
      message: "Credentials were changed too often. Wait a few minutes, then try again.",
    };
  }
  return limit === "unavailable" ? UNAVAILABLE : null;
}

class StateMismatch extends Error {}

class AdminRowError extends Error {
  constructor(readonly problem: Exclude<AdminRowOutcome, { ok: true }>["problem"]) {
    super(`admin row update failed: ${problem}`);
  }
}

/** After a conditional update matched nothing: gone, or in another state now. */
async function mismatch(id: string): Promise<CredentialFailure> {
  const exists = await getControlDb().tenant.count({ where: { id } }).catch(() => 1);
  return exists === 0 ? NOT_FOUND : BUSY;
}

// ---------------------------------------------------------------------------
// Master password

function parseResetInput(input: unknown): MasterPasswordResetInput | null {
  if (typeof input !== "object" || input === null) return null;
  const { mode, password } = input as { mode?: unknown; password?: unknown };
  if (mode === "auto") return { mode: "auto" };
  if (mode === "manual") return { mode: "manual", password: typeof password === "string" ? password : "" };
  return null;
}

/**
 * Sets a new master password (§8.5). Once the admin account exists, its
 * `password_hash` in the tenant database is replaced; before that, the hash
 * waiting for setup (`pending_admin_password_hash`) is.
 */
export async function resetMasterPassword(
  id: string,
  input: MasterPasswordResetInput,
  actor: TenantActor,
): Promise<MasterPasswordResetResult> {
  if (!isUuid(id)) return NOT_FOUND;
  const request = parseResetInput(input);
  if (!request) return { ok: false, reason: "validation", message: "Choose Auto generate or Manual entry." };
  const limited = await limitAction("tenant-admin-password", actor);
  if (limited) return limited;

  const db = getControlDb();
  let tenant;
  try {
    tenant = await db.tenant.findUnique({
      where: { id },
      select: {
        status: true,
        adminUsername: true,
        provisioningSteps: { where: { step: "create_initial_admin" }, select: { step: true } },
      },
    });
  } catch (error) {
    console.error(`[tenants] could not read tenant ${id} for a password reset: ${describeError(error)}`);
    return UNAVAILABLE;
  }
  if (!tenant) return NOT_FOUND;
  if (tenant.status === "provisioning") return BUSY;

  let password: string;
  if (request.mode === "manual") {
    const policy = validateMasterPassword(request.password, tenant.adminUsername);
    if (!policy.ok) return { ok: false, reason: "validation", message: policy.error };
    password = policy.value;
  } else {
    password = generateMasterPassword(tenant.adminUsername);
  }

  const audit = {
    ...ownerAudit(actor),
    tenantId: id,
    action: "tenant.admin_password_reset",
    targetType: "tenant",
    targetId: id,
    metadata: { mode: request.mode },
  } as const;

  const adminExists = tenant.provisioningSteps.length > 0;
  let applied = false;
  try {
    // Argon2id is slow: hashed before any transaction is opened.
    const hash = await hashPassword(password);
    if (adminExists) {
      // The audit row commits only if the tenant database took the new hash.
      await db.$transaction(
        async (tx) => {
          await recordAudit(tx, audit);
          const outcome = await updateTenantAdminRow(id, tenant.adminUsername, { passwordHash: hash });
          if (!outcome.ok) throw new AdminRowError(outcome.problem);
          applied = true;
        },
        { timeout: 20_000 },
      );
    } else {
      await db.$transaction(async (tx) => {
        // Conditional: setup may have started since the tenant was read.
        const { count } = await tx.tenant.updateMany({
          where: { id, status: { not: "provisioning" } },
          data: { pendingAdminPasswordHash: hash },
        });
        if (count !== 1) throw new StateMismatch();
        await recordAudit(tx, audit);
      });
    }
  } catch (error) {
    if (error instanceof StateMismatch) return mismatch(id);
    if (error instanceof AdminRowError) {
      return error.problem === "missing"
        ? {
            ok: false,
            reason: "invalid_state",
            message: "The tenant admin account was not found in the tenant's database. The password was not changed.",
          }
        : {
            ok: false,
            reason: "unavailable",
            message: "The tenant's database could not be reached, so the password was not changed. Try again shortly.",
          };
    }
    if (!applied) {
      console.error(`[tenants] could not reset the master password of tenant ${id}: ${describeError(error)}`);
      return UNAVAILABLE;
    }
    // The tenant database already has the new hash: the old password no
    // longer works, so the change must be reported (only its audit row is lost).
    console.error(
      `[tenants] tenant ${id}: the master password was reset but its audit event could not be recorded: ${describeError(error)}`,
    );
  }

  return request.mode === "auto" ? { ok: true, generatedPassword: password } : { ok: true };
}

// ---------------------------------------------------------------------------
// Database password

/**
 * A new generated password for a provisioned tenant's database login (§8.5).
 * The secret is replaced and the role altered inside one control-plane
 * transaction: a failed ALTER rolls the secret back. Pooled clients holding
 * the old login are closed afterwards.
 */
export async function rotateDatabasePassword(id: string, actor: TenantActor): Promise<CredentialResult> {
  if (!isUuid(id)) return NOT_FOUND;
  const limited = await limitAction("tenant-db-rotate", actor);
  if (limited) return limited;

  const db = getControlDb();
  let tenant;
  try {
    tenant = await db.tenant.findUnique({
      where: { id },
      select: {
        status: true,
        databaseMode: true,
        databaseUser: true,
        databasePort: true,
        databaseSecretRef: true,
        provisioningSteps: { where: { step: "create_database_user" }, select: { step: true } },
      },
    });
  } catch (error) {
    console.error(`[tenants] could not read tenant ${id} for a rotation: ${describeError(error)}`);
    return UNAVAILABLE;
  }
  if (!tenant) return NOT_FOUND;
  if (tenant.status === "provisioning") return BUSY;
  if (tenant.databaseMode !== "provisioned") {
    return {
      ok: false,
      reason: "invalid_state",
      message: "This tenant uses an existing database. Update its password instead.",
    };
  }
  const { databaseUser: role, databasePort: port, databaseSecretRef: secretId } = tenant;
  // Only a role the platform created (and so may alter) is rotated.
  if (tenant.provisioningSteps.length === 0 || !role || port === null || !secretId) {
    return {
      ok: false,
      reason: "invalid_state",
      message: "The database user has not been created yet. Finish setup first.",
    };
  }

  let previous: string;
  try {
    previous = await readSecret(secretId, "tenant_database_password");
  } catch (error) {
    console.error(`[tenants] could not read the database secret of tenant ${id}: ${describeError(error)}`);
    return UNAVAILABLE;
  }

  const next = generateDatabasePassword();
  let altered = false;
  try {
    await db.$transaction(
      async (tx) => {
        await replaceSecret(tx, secretId, "tenant_database_password", next);
        await recordAudit(tx, {
          ...ownerAudit(actor),
          tenantId: id,
          action: "tenant.database_password_rotated",
          targetType: "tenant",
          targetId: id,
        });
        // Last, so a refusal here rolls back the secret and the audit row.
        await setRolePassword(role, next, port);
        altered = true;
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    console.error(`[tenants] could not rotate the database password of tenant ${id}: ${describeError(error)}`);
    if (altered) {
      // The role has the new password but the stored secret is still the old
      // one: put the role back so the two agree again.
      await setRolePassword(role, previous, port).catch((restoreError: unknown) => {
        console.error(
          `[tenants] tenant ${id}: the database role could not be set back to the stored password; rotate again: ${describeError(restoreError)}`,
        );
      });
    }
    evictTenantDb(id);
    return {
      ok: false,
      reason: "unavailable",
      message: "The database password could not be rotated. The previous password still works. Try again shortly.",
    };
  }

  evictTenantDb(id);
  return { ok: true };
}

/**
 * Stores a password the owner already set on an existing database's login
 * (§8.5). It is tried first: one that cannot sign in is never saved.
 */
export async function updateExistingDatabasePassword(
  id: string,
  password: string,
  actor: TenantActor,
): Promise<CredentialResult> {
  if (!isUuid(id)) return NOT_FOUND;
  const valid = validateExistingDatabasePassword(typeof password === "string" ? password : "");
  if (!valid.ok) return { ok: false, reason: "validation", message: valid.error };
  const limited = await limitAction("tenant-db-password", actor);
  if (limited) return limited;

  const db = getControlDb();
  let tenant;
  try {
    tenant = await db.tenant.findUnique({
      where: { id },
      select: {
        status: true,
        databaseMode: true,
        databaseName: true,
        databaseUser: true,
        databasePort: true,
        databaseSecretRef: true,
      },
    });
  } catch (error) {
    console.error(`[tenants] could not read tenant ${id} for a password update: ${describeError(error)}`);
    return UNAVAILABLE;
  }
  if (!tenant) return NOT_FOUND;
  if (tenant.status === "provisioning") return BUSY;
  if (tenant.databaseMode !== "existing") {
    return {
      ok: false,
      reason: "invalid_state",
      message: "This tenant's database was created by the platform. Rotate its password instead.",
    };
  }
  const { databaseName, databaseUser, databasePort, databaseSecretRef } = tenant;
  if (!databaseName || !databaseUser || databasePort === null || !databaseSecretRef) {
    return { ok: false, reason: "invalid_state", message: "This tenant has no database login on record." };
  }

  const login = await testDatabaseLogin({
    database: databaseName,
    user: databaseUser,
    password: valid.value,
    port: databasePort,
  });
  if (!login.ok) {
    return {
      ok: false,
      reason: "validation",
      message: `The database did not accept this password, so it was not saved. ${login.message}`,
    };
  }

  try {
    await db.$transaction(async (tx) => {
      await replaceSecret(tx, databaseSecretRef, "tenant_database_password", valid.value);
      await recordAudit(tx, {
        ...ownerAudit(actor),
        tenantId: id,
        action: "tenant.database_password_updated",
        targetType: "tenant",
        targetId: id,
      });
    });
  } catch (error) {
    console.error(`[tenants] could not store the database password of tenant ${id}: ${describeError(error)}`);
    return UNAVAILABLE;
  }
  evictTenantDb(id);
  return { ok: true };
}

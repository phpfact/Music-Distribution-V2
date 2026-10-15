import "server-only";
/**
 * Creating a tenant (docs/tenant-management.md §8.1).
 *
 * Records the tenant, its domains, its encrypted database password and the
 * hash of its admin password in one transaction. The database itself is set
 * up afterwards by the provisioning runner: the caller schedules
 * `startProvisioning` once the response is on its way, which keeps this
 * function quick and testable.
 */
import { randomUUID } from "node:crypto";
import { recordAudit } from "@/lib/audit";
import { getControlDb } from "@/lib/db/control";
import { normalizeCustomDomainInput } from "@/lib/domains/idn";
import { validateSubdomainLabel } from "@/lib/domains/rules";
import { getEnv } from "@/lib/env";
import { hashPassword } from "@/lib/platform-auth/password";
import { describeError } from "@/lib/platform-auth/session";
import {
  checkExistingDatabase,
  type DatabaseCheck,
  ProvisioningError,
  type ProvisioningOptions,
  type ProvisioningOutcome,
  runProvisioning,
} from "@/lib/provisioning";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createSecret } from "@/lib/secrets";
import { deleteStoredFile } from "@/lib/storage/files";
import { validateProfileImage } from "@/lib/storage/image";
import { storeProfileImage } from "@/lib/storage/profile-images";
import {
  generateDatabasePassword,
  generateMasterPassword,
  generateVerificationToken,
} from "@/lib/tenants/generate";
import {
  parsePort,
  type RuleResult,
  validateDatabaseIdentifier,
  validateEmail,
  validateExistingDatabasePassword,
  validateFullName,
  validateMasterPassword,
  validateNewDatabasePassword,
  validatePhone,
  validateTenantUsername,
} from "@/lib/tenants/rules";
import { type NameKind, takenInControlPlane, takenOnServer } from "./availability";
import {
  isUuid,
  ownerAudit,
  provisioningActor,
  type ServiceFailure,
  type TenantActor,
  UNAVAILABLE_MESSAGE,
} from "./common";

/** The form's field names: a contract with the create form. */
export type CreateTenantField =
  | "fullName"
  | "phone"
  | "profileImage"
  | "username"
  | "email"
  | "masterPassword"
  | "databaseName"
  | "databaseUser"
  | "databasePassword"
  | "databasePort"
  | "subdomain"
  | "customDomain"
  // One Auto-Generate / Manual switch per form section (see CredentialModes).
  | "loginMode"
  | "databaseCredentialMode"
  | "subdomainMode"
  | "databaseMode";

export type CreateTenantFieldErrors = Partial<Record<CreateTenantField, string>>;

export type CredentialMode = "auto" | "manual";
export type DatabaseMode = "provisioned" | "existing";

/**
 * Which sections of the create form the owner left on Auto-Generate. Each
 * section is independent, so e.g. the login can be generated while the
 * database credentials are typed by hand.
 *
 * - `login`: the admin username and master password.
 * - `database`: the database name, user, password and port.
 * - `subdomain`: the SaaS subdomain label.
 */
export type CredentialModes = {
  login: CredentialMode;
  database: CredentialMode;
  subdomain: CredentialMode;
};

/**
 * Raw form values, untrimmed. A section in `auto` mode has its secrets
 * ignored: with `loginMode` auto the master password is generated here, and
 * with `databaseCredentialMode` auto the database password and port are
 * generated or defaulted here, whatever the request contains.
 */
export type CreateTenantInput = {
  fullName: string;
  phone: string;
  username: string;
  email: string;
  masterPassword: string;
  databaseName: string;
  databaseUser: string;
  databasePassword: string;
  databasePort: string;
  subdomain: string;
  customDomain: string;
  loginMode: string;
  databaseCredentialMode: string;
  subdomainMode: string;
  databaseMode: string;
  profileImage: { bytes: Uint8Array } | null;
};

export type CreateTenantResult =
  | { ok: true; tenantId: string; generatedMasterPassword?: string }
  | {
      ok: false;
      reason: "validation";
      fieldErrors: CreateTenantFieldErrors;
      /** The existing-database checks, when they were run and one failed. */
      checks?: DatabaseCheck[];
    }
  | ServiceFailure<"rate_limited" | "unavailable">;

/** For tests: replace the up-front name checks (e.g. to provoke a unique violation). */
export type CreateTenantDeps = {
  takenInControlPlane?: typeof takenInControlPlane;
};

const CREATE_LIMIT = { limit: 20, windowSeconds: 60 * 60 };

type ValidTenant = {
  modes: CredentialModes;
  databaseMode: DatabaseMode;
  fullName: string;
  phone: string | null;
  username: string;
  email: string;
  masterPassword: string;
  databaseName: string;
  databaseUser: string;
  databasePassword: string;
  databasePort: number;
  subdomain: string;
  customDomain: string | null;
};

// ---------------------------------------------------------------------------
// Validation (§4, §8.1 steps 2-3)

/**
 * Description: Read one section's Auto-Generate / Manual switch from the request.
 * Input: The submitted text.
 * Output: "auto", "manual", or null for anything else.
 * Use case: validateInput (loginMode, databaseCredentialMode, subdomainMode).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function parseCredentialMode(value: string): CredentialMode | null {
  return value === "auto" || value === "manual" ? value : null;
}

/**
 * Description: Read the database mode from the request.
 * Input: The submitted text.
 * Output: "provisioned", "existing", or null for anything else.
 * Use case: validateInput.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function parseDatabaseMode(value: string): DatabaseMode | null {
  return value === "provisioned" || value === "existing" ? value : null;
}

/**
 * Description: Validate the whole create request with the shared tenant rules.
 * Input: The raw (untrimmed) request values.
 * Output: Every field error at once, or the normalized tenant values. Auto sections
 *   have their secrets generated (master password; database password and the
 *   configured port) whatever the request contains.
 * Use case: createTenant (§4, §8.1 steps 2-3).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function validateInput(
  input: CreateTenantInput,
): { ok: true; value: ValidTenant } | { ok: false; fieldErrors: CreateTenantFieldErrors } {
  const env = getEnv();
  const fieldErrors: CreateTenantFieldErrors = {};
  // Records the error of a failed rule and returns the value of a passed one.
  const check = <T>(field: CreateTenantField, result: RuleResult<T>): T | undefined => {
    if (result.ok) return result.value;
    fieldErrors[field] = result.error;
    return undefined;
  };

  // Step 1: the three section modes. Each one is checked on its own so the
  // error lands under the switch of the section it belongs to.
  const MODE_REQUIRED = "Choose Auto-Generate or Manual.";
  const loginMode     = parseCredentialMode(input.loginMode);
  if (!loginMode) fieldErrors.loginMode = MODE_REQUIRED;
  const databaseCredentialMode = parseCredentialMode(input.databaseCredentialMode);
  if (!databaseCredentialMode) fieldErrors.databaseCredentialMode = MODE_REQUIRED;
  const subdomainMode = parseCredentialMode(input.subdomainMode);
  if (!subdomainMode) fieldErrors.subdomainMode = MODE_REQUIRED;

  // Step 2: the database mode. Only the Database section's own switch matters:
  // the owner has to supply the existing database's login, so it cannot be generated.
  const databaseMode = parseDatabaseMode(input.databaseMode);
  if (!databaseMode) {
    fieldErrors.databaseMode = "Choose whether to create a new database or use an existing one.";
  } else if (databaseMode === "existing" && databaseCredentialMode === "auto") {
    fieldErrors.databaseMode = "Switch the Database section to Manual to attach an existing database.";
  }

  const fullName = check("fullName", validateFullName(input.fullName));
  const phone    = check("phone", validatePhone(input.phone));
  const username = check("username", validateTenantUsername(input.username));
  const email    = check("email", validateEmail(input.email));

  const reservedNames = [env.postgres.database, env.postgres.user];
  const databaseName = check(
    "databaseName",
    validateDatabaseIdentifier(input.databaseName, "database", { reservedNames }),
  );
  const databaseUser = check(
    "databaseUser",
    validateDatabaseIdentifier(input.databaseUser, "user", { reservedNames }),
  );

  // Secrets of a section on Auto are generated here and never taken from the
  // request, whatever it contains. A section on Manual must supply its own.
  // An invalid mode (already reported above) is treated like Auto so that no
  // further, misleading password errors are added for it.
  let masterPassword: string | undefined;
  if (loginMode === "manual") {
    masterPassword = check(
      "masterPassword",
      validateMasterPassword(input.masterPassword, username ?? input.username),
    );
  } else {
    masterPassword = generateMasterPassword(username ?? "");
  }

  let databasePassword: string | undefined;
  let databasePort: number | undefined;
  if (databaseCredentialMode === "manual") {
    // An existing login keeps whatever password it already has; a new one
    // must meet the stronger new-database rule.
    databasePassword = check(
      "databasePassword",
      databaseMode === "existing"
        ? validateExistingDatabasePassword(input.databasePassword)
        : validateNewDatabasePassword(input.databasePassword),
    );
    databasePort = check("databasePort", parsePort(input.databasePort, env.postgres.port));
  } else {
    databasePassword = generateDatabasePassword();
    databasePort = env.postgres.port;
  }

  const subdomain = check("subdomain", validateSubdomainLabel(input.subdomain));
  const customDomain =
    input.customDomain.trim().length === 0
      ? null
      : check("customDomain", normalizeCustomDomainInput(input.customDomain, env.platformBaseDomain));

  if (input.profileImage) {
    const image = validateProfileImage(input.profileImage.bytes);
    if (!image.ok) fieldErrors.profileImage = image.error;
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return {
    ok: true,
    value: {
      // All three are set here: any missing mode returned a field error above.
      modes: {
        login: loginMode as CredentialMode,
        database: databaseCredentialMode as CredentialMode,
        subdomain: subdomainMode as CredentialMode,
      },
      databaseMode: databaseMode as DatabaseMode,
      fullName: fullName as string,
      phone: phone ?? null,
      username: username as string,
      email: email as string,
      masterPassword: masterPassword as string,
      databaseName: databaseName as string,
      databaseUser: databaseUser as string,
      databasePassword: databasePassword as string,
      databasePort: databasePort as number,
      subdomain: subdomain as string,
      customDomain: customDomain ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Uniqueness (§8.1 step 4)

export const TAKEN_MESSAGES: Record<NameKind, string> = {
  username: "This user name is already used by another tenant. Choose another one.",
  email: "This email address is already used by another tenant. Use another one.",
  subdomain: "This subdomain is already taken. Choose another one.",
  customDomain: "This domain is already used by another tenant.",
  databaseName: "Another tenant already uses this database name. Choose another one.",
  databaseUser: "Another tenant already uses this database user. Choose another one.",
};

// The previewable names and the form section whose switch decides whether the
// owner typed them (Manual) or took the preview (Auto).
type GeneratedName = "username" | "subdomain" | "databaseName" | "databaseUser";
const GENERATED_FIELD_SECTIONS: Record<GeneratedName, keyof CredentialModes> = {
  username: "login",
  subdomain: "subdomain",
  databaseName: "database",
  databaseUser: "database",
};

/**
 * Description: Tell whether a name was generated (previewed) rather than typed by the owner.
 * Input: The name kind that conflicted and the validated tenant with its section modes.
 * Output: True when the name belongs to a section left on Auto-Generate.
 * Use case: A generated name someone took in the meantime gets "regenerate" wording.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function isGeneratedName(kind: NameKind, tenant: ValidTenant): kind is GeneratedName {
  // Email and custom domain are always typed, so they never count as generated.
  if (!(kind in GENERATED_FIELD_SECTIONS)) return false;
  return tenant.modes[GENERATED_FIELD_SECTIONS[kind as GeneratedName]] === "auto";
}

/**
 * Description: Build the field error for a name that another tenant or the server already uses.
 * Input: The conflicting name kind and the validated tenant.
 * Output: "<value> is no longer available — regenerate." for generated names, else the fixed message.
 * Use case: Availability checks and unique-constraint races during creation.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function takenMessage(kind: NameKind, tenant: ValidTenant): string {
  // The owner did not type a generated name: it was previewed and someone took
  // it in the meantime, so the fix is to regenerate, not to "choose another".
  if (isGeneratedName(kind, tenant)) {
    return `${tenant[kind]} is no longer available — regenerate.`;
  }
  return TAKEN_MESSAGES[kind];
}

type AvailabilityOutcome =
  | { ok: true }
  | { ok: false; result: CreateTenantResult };

/**
 * Description: Check that every name of the new tenant is still free.
 * Input: The validated tenant and the test dependencies.
 * Output: ok, field errors ("is no longer available — regenerate" for generated
 *   names), a port error when a typed port cannot be reached, or unavailable.
 *   For a new database the PostgreSQL server itself is asked too.
 * Use case: createTenant (§8.1 step 4).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
async function checkAvailability(
  tenant: ValidTenant,
  deps: CreateTenantDeps,
): Promise<AvailabilityOutcome> {
  const lookup = deps.takenInControlPlane ?? takenInControlPlane;
  // An existing database exists by definition; whether it is free is check 3 of §6.4.
  const askServer = tenant.databaseMode === "provisioned";
  let taken: Set<NameKind>;
  let onServer = { databaseName: false, databaseUser: false };
  try {
    [taken, onServer] = await Promise.all([
      lookup({
        username: tenant.username,
        email: tenant.email,
        subdomain: tenant.subdomain,
        customDomain: tenant.customDomain,
        databaseName: tenant.databaseName,
        databaseUser: tenant.databaseUser,
      }),
      askServer ? takenOnServer(tenant.databaseName, tenant.databaseUser, tenant.databasePort) : onServer,
    ]);
  } catch (error) {
    console.error(`[tenants] availability check failed: ${describeError(error)}`);
    // Only a port the owner typed (Database section on Manual) can be the
    // cause they can fix; the configured default port is an outage instead.
    if (error instanceof ProvisioningError && tenant.modes.database === "manual") {
      return {
        ok: false,
        result: {
          ok: false,
          reason: "validation",
          fieldErrors: {
            databasePort: `The database server on port ${tenant.databasePort} could not be reached with the platform's administrative login. Check the port.`,
          },
        },
      };
    }
    return { ok: false, result: { ok: false, reason: "unavailable", message: UNAVAILABLE_MESSAGE } };
  }

  const fieldErrors: CreateTenantFieldErrors = {};
  for (const kind of taken) fieldErrors[kind] = takenMessage(kind, tenant);
  // Names already present on the database server itself (not in the control
  // plane): generated names say "regenerate", typed names say "choose another".
  if (!fieldErrors.databaseName && onServer.databaseName) {
    fieldErrors.databaseName = isGeneratedName("databaseName", tenant)
      ? takenMessage("databaseName", tenant)
      : "A database with this name already exists on the server. Choose another name.";
  }
  if (!fieldErrors.databaseUser && onServer.databaseUser) {
    fieldErrors.databaseUser = isGeneratedName("databaseUser", tenant)
      ? takenMessage("databaseUser", tenant)
      : "A role with this name already exists on the server. Choose another name.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, result: { ok: false, reason: "validation", fieldErrors } };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Unique violations at insert time (races between two creates)

// Which field each unique index protects. tenant_domains(type, hostname) is
// shared by both domain kinds; the insert that failed tells them apart.
const INDEX_FIELDS: [index: string, field: NameKind][] = [
  ["tenants_admin_username_key", "username"],
  ["tenants_contact_email_key", "email"],
  ["tenants_slug_key", "subdomain"],
  ["tenants_database_name_key", "databaseName"],
  ["tenants_database_user_key", "databaseUser"],
];

export type InsertStage = "tenant" | "subdomain" | "customDomain" | "other";

/**
 * Description: Map a unique violation at insert time to its form field.
 * Input: The thrown error and the insert stage that failed.
 * Output: The name kind the violated index protects, or null for any other error.
 *   Catches races between two concurrent creates.
 * Use case: createTenant's transaction error handling.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function uniqueViolationField(error: unknown, stage: InsertStage): NameKind | null {
  if (typeof error !== "object" || error === null || (error as { code?: unknown }).code !== "P2002") {
    return null;
  }
  // With the pg driver adapter the index name is in meta.driverAdapterError;
  // the message carries it too. Searching both survives either shape.
  const detail = `${JSON.stringify((error as { meta?: unknown }).meta ?? {})} ${String((error as Error).message)}`;
  for (const [index, field] of INDEX_FIELDS) {
    if (detail.includes(index)) return field;
  }
  if (stage === "subdomain" || stage === "customDomain") return stage;
  return null;
}

// ---------------------------------------------------------------------------

/**
 * Description: Create the tenant record (§8.1 steps 1-7 and 9).
 * Input: The raw request values, the acting owner and optional test dependencies.
 * Output: The new tenant id (plus the generated master password once, for an Auto
 *   login), field errors, or a rate-limit/unavailable message. One transaction
 *   writes the tenant, domains, encrypted database secret, admin password hash and
 *   audit event. Provisioning is not started here.
 * Use case: createTenantAction; the caller schedules startProvisioning afterwards.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function createTenant(
  input: CreateTenantInput,
  actor: TenantActor,
  deps: CreateTenantDeps = {},
): Promise<CreateTenantResult> {
  // 1. Rate limit (fails closed).
  const limit = await consumeRateLimit({ key: `tenant-create:${actor.ownerId}`, ...CREATE_LIMIT });
  if (limit === "limited") {
    return {
      ok: false,
      reason: "rate_limited",
      message: "Too many tenants were created in the last hour. Try again later.",
    };
  }
  if (limit === "unavailable") {
    return { ok: false, reason: "unavailable", message: UNAVAILABLE_MESSAGE };
  }

  // 2-3. Every field, and the mode rules.
  const validation = validateInput(input);
  if (!validation.ok) return { ok: false, reason: "validation", fieldErrors: validation.fieldErrors };
  const tenant = validation.value;

  // 4. Names still free.
  const availability = await checkAvailability(tenant, deps);
  if (!availability.ok) return availability.result;

  // 5. An existing database must pass every §6.4 check.
  if (tenant.databaseMode === "existing") {
    let outcome: Awaited<ReturnType<typeof checkExistingDatabase>>;
    try {
      outcome = await checkExistingDatabase({
        database: tenant.databaseName,
        user: tenant.databaseUser,
        password: tenant.databasePassword,
        port: tenant.databasePort,
      });
    } catch (error) {
      console.error(`[tenants] existing database check failed: ${describeError(error)}`);
      return { ok: false, reason: "unavailable", message: UNAVAILABLE_MESSAGE };
    }
    if (!outcome.ok) {
      return { ok: false, reason: "validation", fieldErrors: {}, checks: outcome.checks };
    }
  }

  // Generated here so the image key can name the tenant before the row exists.
  const tenantId = randomUUID();

  // 6. The profile image, before the transaction (files are not transactional).
  let imageKey: string | null = null;
  if (input.profileImage) {
    try {
      const stored = await storeProfileImage(tenantId, input.profileImage.bytes);
      if (!stored.ok) {
        return { ok: false, reason: "validation", fieldErrors: { profileImage: stored.error } };
      }
      imageKey = stored.value;
    } catch (error) {
      console.error(`[tenants] could not store a profile image: ${describeError(error)}`);
      return { ok: false, reason: "unavailable", message: "The profile image could not be saved. Try again." };
    }
  }

  // 7. One transaction. Argon2id runs first: it is slow and needs no lock.
  let stage: InsertStage = "other";
  try {
    const pendingAdminPasswordHash = await hashPassword(tenant.masterPassword);
    await getControlDb().$transaction(async (tx) => {
      const plan = await tx.plan.findFirst({ where: { isDefault: true }, select: { id: true } });
      if (!plan) throw new Error("no default plan is configured");
      const secretId = await createSecret(tx, "tenant_database_password", tenant.databasePassword);

      stage = "tenant";
      await tx.tenant.create({
        data: {
          id: tenantId,
          name: tenant.fullName,
          slug: tenant.subdomain,
          status: "pending",
          contactEmail: tenant.email,
          adminUsername: tenant.username,
          phone: tenant.phone,
          profileImageKey: imageKey,
          planId: plan.id,
          databaseMode: tenant.databaseMode,
          databaseName: tenant.databaseName,
          databaseUser: tenant.databaseUser,
          databasePort: tenant.databasePort,
          databaseSecretRef: secretId,
          pendingAdminPasswordHash,
        },
      });

      stage = "subdomain";
      await tx.tenantDomain.create({
        data: { tenantId, type: "subdomain", hostname: tenant.subdomain, status: "pending" },
      });
      if (tenant.customDomain) {
        stage = "customDomain";
        await tx.tenantDomain.create({
          data: {
            tenantId,
            type: "custom",
            hostname: tenant.customDomain,
            status: "pending",
            verificationToken: generateVerificationToken(),
          },
        });
      }

      stage = "other";
      await recordAudit(tx, {
        ...ownerAudit(actor),
        tenantId,
        action: "tenant.created",
        targetType: "tenant",
        targetId: tenantId,
        // Which options were used, never the values.
        metadata: {
          loginMode: tenant.modes.login,
          databaseCredentialMode: tenant.modes.database,
          subdomainMode: tenant.modes.subdomain,
          databaseMode: tenant.databaseMode,
          hasCustomDomain: tenant.customDomain !== null,
        },
      });
    });
  } catch (error) {
    if (imageKey) {
      await deleteStoredFile(imageKey).catch((cleanupError: unknown) => {
        console.error(`[tenants] could not remove an orphaned profile image: ${describeError(cleanupError)}`);
      });
    }
    const field = uniqueViolationField(error, stage);
    if (field) {
      return { ok: false, reason: "validation", fieldErrors: { [field]: takenMessage(field, tenant) } };
    }
    console.error(`[tenants] could not create a tenant: ${describeError(error)}`);
    return { ok: false, reason: "unavailable", message: UNAVAILABLE_MESSAGE };
  }

  // 9. A generated master password (login section on Auto) goes back once
  // and is not kept anywhere; a typed one is never echoed back.
  return tenant.modes.login === "auto"
    ? { ok: true, tenantId, generatedMasterPassword: tenant.masterPassword }
    : { ok: true, tenantId };
}

/**
 * Description: Run (or continue) a tenant's provisioning after the response was sent.
 * Input: The tenant id, the acting owner and runner options.
 * Output: The runner's outcome. Never throws: the outcome is recorded by the runner
 *   and logged here.
 * Use case: next/server after() in createTenantAction and retryProvisioningAction.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function startProvisioning(
  tenantId: string,
  actor: TenantActor,
  options?: ProvisioningOptions,
): Promise<ProvisioningOutcome> {
  if (!isUuid(tenantId)) return { status: "invalid_state", tenantStatus: "not_found" };
  try {
    const outcome = await runProvisioning(tenantId, provisioningActor(actor), options);
    const detail  = outcome.status === "failed" ? ` (${outcome.code})` : "";
    console.info(`[tenants] provisioning of ${tenantId} ended: ${outcome.status}${detail}`);
    return outcome;
  } catch (error) {
    console.error(`[tenants] provisioning of ${tenantId} could not run: ${describeError(error)}`);
    return {
      status: "failed",
      code: "internal",
      message: "Setup could not be started. Retry setup.",
    };
  }
}

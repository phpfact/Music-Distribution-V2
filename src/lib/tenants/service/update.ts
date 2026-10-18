import "server-only";
/**
 * Editing a tenant's profile, login names and domains
 * (docs/tenant-management.md §8.4).
 *
 * Only what changed is written. The tenant admin's user name and email also
 * live in the tenant's own database once the admin account exists, and the
 * two databases cannot share a transaction: the control plane commits desired
 * identity plus durable recovery state before the locked tenant commit.
 * Interrupted edits are reconciled by immutable admin ID on the next write. Credentials are
 * never touched here; they have their own actions (credentials.ts).
 */
import type { Prisma } from "@/generated/prisma/control/client";
import { recordAudit } from "@/lib/audit";
import { getControlDb } from "@/lib/db/control";
import type { DnsResolver } from "@/lib/domains/dns";
import { normalizeCustomDomainInput } from "@/lib/domains/idn";
import { validateSubdomainLabel } from "@/lib/domains/rules";
import { getEnv } from "@/lib/env";
import { describeError } from "@/lib/platform-auth/session";
import { deleteStoredFile } from "@/lib/storage/files";
import { validateProfileImage } from "@/lib/storage/image";
import { storeProfileImage } from "@/lib/storage/profile-images";
import { generateVerificationToken } from "@/lib/tenants/generate";
import {
  type RuleResult,
  validateEmail,
  validateFullName,
  validatePhone,
  validateTenantUsername,
} from "@/lib/tenants/rules";
import { identityConflictErrors } from "@/lib/workspace/identity";
import type { TenantStatus } from "@/app/platform/(console)/tenants/labels";
import { type NameKind, takenInControlPlane } from "./availability";
import { isUuid, ownerAudit, type ServiceFailure, type TenantActor, UNAVAILABLE_MESSAGE } from "./common";
import {
  type CreateTenantField,
  type InsertStage,
  TAKEN_MESSAGES,
  uniqueViolationField,
} from "./create";
import { checkSubdomainRow } from "./domains";
import { type AdminRowChange, type AdminRowOutcome, updateTenantAdminRow } from "./tenant-admin";

/** The edit form's fields: the same names as the create form's. */
export type UpdateTenantField = Extract<
  CreateTenantField,
  "fullName" | "phone" | "profileImage" | "username" | "email" | "subdomain" | "customDomain"
>;

export type UpdateTenantFieldErrors = Partial<Record<UpdateTenantField, string>>;

export type ProfileImageChange =
  | { action: "keep" }
  | { action: "remove" }
  | { action: "replace"; bytes: Uint8Array };

/** Raw form values, untrimmed. An empty custom domain removes it. */
export type UpdateTenantInput = {
  fullName: string;
  phone: string;
  email: string;
  username: string;
  subdomain: string;
  customDomain: string;
  profileImage: ProfileImageChange;
};

export type UpdateTenantResult =
  | {
      ok: true;
      tenantId: string;
      /** The fields that were written, in form order; empty when nothing changed. */
      changed: UpdateTenantField[];
      /** A domain changed and still waits for DNS (the subdomain check failed, or a custom domain needs its TXT record). */
      dnsPending: boolean;
    }
  | { ok: false; reason: "validation"; fieldErrors: UpdateTenantFieldErrors }
  | ServiceFailure<"not_found" | "invalid_state" | "unavailable">;

/** For tests: a fake resolver for the immediate subdomain check. */
export type UpdateTenantDeps = { dnsResolver?: DnsResolver };

/** The edit form's initial values. No secrets, no hashes, no secret references. */
export type TenantForEdit = {
  id: string;
  status: TenantStatus;
  fullName: string;
  phone: string | null;
  email: string;
  username: string;
  /** The subdomain label ("acme"), without the base domain. */
  subdomain: string;
  /** The custom host name, or null. */
  customDomain: string | null;
  hasProfileImage: boolean;
  /** The admin account exists in the tenant database (setup created it). */
  adminAccountExists: boolean;
  baseDomain: string;
};

const NOT_FOUND   = { ok: false, reason: "not_found", message: "This tenant does not exist." } as const;
const UNAVAILABLE = { ok: false, reason: "unavailable", message: UNAVAILABLE_MESSAGE } as const;
const BUSY = {
  ok: false,
  reason: "invalid_state",
  message: "Wait until setup finishes before editing.",
} as const;

// The form's order, so `changed` (and the audit row) reads naturally.
const FIELD_ORDER: readonly UpdateTenantField[] = [
  "fullName",
  "phone",
  "profileImage",
  "username",
  "email",
  "subdomain",
  "customDomain",
];

class StateMismatch extends Error {}

// ---------------------------------------------------------------------------
// Reading

const EDITABLE_SELECT = {
  id: true,
  status: true,
  name: true,
  phone: true,
  contactEmail: true,
  adminUsername: true,
  profileImageKey: true,
  adminIdentityVersion: true,
  adminIdentitySyncPending: true,
  domains: { select: { id: true, type: true, hostname: true } },
  provisioningSteps: { where: { step: "create_initial_admin" }, select: { step: true } },
} satisfies Prisma.TenantSelect;

type EditableRow = Prisma.TenantGetPayload<{ select: typeof EDITABLE_SELECT }>;

/**
 * Description: Load the columns an edit reads and compares.
 * Input: The tenant id.
 * Output: The editable row (with domains and the admin-creation step), or null.
 * Use case: getTenantForEdit and updateTenantProfile.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function loadEditable(id: string): Promise<EditableRow | null> {
  return getControlDb().tenant.findUnique({ where: { id }, select: EDITABLE_SELECT });
}

/**
 * Description: Pick a tenant's domain row of one type.
 * Input: The editable row and the domain type.
 * Output: The subdomain or custom domain row, or null.
 * Use case: getTenantForEdit, changedFields and updateTenantProfile.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function domainOf(row: EditableRow, type: "subdomain" | "custom") {
  return row.domains.find((domain) => domain.type === type) ?? null;
}

/**
 * Description: Load a tenant's saved values for the edit form.
 * Input: The tenant id from the URL.
 * Output: The edit DTO (no secrets), or null for an unknown or malformed id.
 * Use case: The edit page (the form is prefilled with these values).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function getTenantForEdit(id: string): Promise<TenantForEdit | null> {
  if (!isUuid(id)) return null;
  const row = await loadEditable(id);
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    fullName: row.name,
    phone: row.phone,
    email: row.contactEmail,
    username: row.adminUsername,
    subdomain: domainOf(row, "subdomain")?.hostname ?? "",
    customDomain: domainOf(row, "custom")?.hostname ?? null,
    hasProfileImage: row.profileImageKey !== null,
    adminAccountExists: row.provisioningSteps.length > 0,
    baseDomain: getEnv().platformBaseDomain,
  };
}

// ---------------------------------------------------------------------------
// Validation (the create rules, §4)

type EditValues = {
  fullName: string;
  phone: string | null;
  username: string;
  email: string;
  subdomain: string;
  customDomain: string | null;
  image: ProfileImageChange;
};

/**
 * Description: Read an untrusted value as text.
 * Input: Any value.
 * Output: The string, or "" for anything that is not a string.
 * Use case: validateEdit.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Description: Validate an edit request with the create rules (§4).
 * Input: The raw request values and PLATFORM_BASE_DOMAIN.
 * Output: Every field error at once, or the normalized values (custom domain
 *   converted to punycode; empty means remove).
 * Use case: updateTenantProfile.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function validateEdit(
  input: UpdateTenantInput,
  baseDomain: string,
): { ok: true; value: EditValues } | { ok: false; fieldErrors: UpdateTenantFieldErrors } {
  const fieldErrors: UpdateTenantFieldErrors = {};
  const check = <T>(field: UpdateTenantField, result: RuleResult<T>): T | undefined => {
    if (result.ok) return result.value;
    fieldErrors[field] = result.error;
    return undefined;
  };

  const fullName        = check("fullName", validateFullName(text(input.fullName)));
  const phone           = check("phone", validatePhone(text(input.phone)));
  const username        = check("username", validateTenantUsername(text(input.username)));
  const email           = check("email", validateEmail(text(input.email)));
  const subdomain       = check("subdomain", validateSubdomainLabel(text(input.subdomain)));
  const rawCustomDomain = text(input.customDomain);
  const customDomain =
    rawCustomDomain.trim().length === 0
      ? null
      : check("customDomain", normalizeCustomDomainInput(rawCustomDomain, baseDomain));

  // The Server Action builds this from form fields; still checked, not trusted.
  const image = input.profileImage as ProfileImageChange | undefined;
  if (image?.action === "replace") {
    const sniffed =
      image.bytes instanceof Uint8Array
        ? validateProfileImage(image.bytes)
        : ({ ok: false, error: "Choose a PNG, JPEG or WebP image." } as const);
    if (!sniffed.ok) fieldErrors.profileImage = sniffed.error;
  } else if (image?.action !== "keep" && image?.action !== "remove") {
    fieldErrors.profileImage = "Choose whether to keep, replace or remove the profile image.";
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return {
    ok: true,
    value: {
      fullName: fullName as string,
      phone: phone ?? null,
      username: username as string,
      email: email as string,
      subdomain: subdomain as string,
      customDomain: customDomain ?? null,
      image: image as ProfileImageChange,
    },
  };
}

/**
 * Description: List the fields an edit actually changes.
 * Input: The saved row and the validated new values.
 * Output: The changed fields in form order.
 * Use case: updateTenantProfile (only changes are written and audited).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function changedFields(current: EditableRow, next: EditValues): UpdateTenantField[] {
  const changed = new Set<UpdateTenantField>();
  if (next.fullName !== current.name) changed.add("fullName");
  if (next.phone !== current.phone) changed.add("phone");
  if (next.image.action === "replace") changed.add("profileImage");
  if (next.image.action === "remove" && current.profileImageKey !== null) changed.add("profileImage");
  if (next.username !== current.adminUsername) changed.add("username");
  if (next.email !== current.contactEmail) changed.add("email");
  if (next.subdomain !== domainOf(current, "subdomain")?.hostname) changed.add("subdomain");
  if (next.customDomain !== (domainOf(current, "custom")?.hostname ?? null)) changed.add("customDomain");
  return FIELD_ORDER.filter((field) => changed.has(field));
}

// ---------------------------------------------------------------------------
// Steps

/**
 * Description: Find edited names that another tenant already holds.
 * Input: The tenant id, the new values and the changed fields.
 * Output: Field errors for the taken names (empty when all are free).
 * Use case: updateTenantProfile.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
async function takenNames(
  id: string,
  next: EditValues,
  changed: ReadonlySet<UpdateTenantField>,
): Promise<UpdateTenantFieldErrors> {
  const taken = await takenInControlPlane(
    {
      username: changed.has("username") ? next.username : null,
      email: changed.has("email") ? next.email : null,
      subdomain: changed.has("subdomain") ? next.subdomain : null,
      customDomain: changed.has("customDomain") ? next.customDomain : null,
    },
    id,
  );
  const fieldErrors: UpdateTenantFieldErrors = {};
  for (const kind of taken) {
    const field = editField(kind);
    if (field) fieldErrors[field] = TAKEN_MESSAGES[kind];
  }
  return fieldErrors;
}

/**
 * Description: Map an availability name kind to an edit-form field.
 * Input: The name kind.
 * Output: username, email, subdomain or customDomain; null for the database names.
 * Use case: takenNames.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function editField(kind: NameKind): UpdateTenantField | null {
  return kind === "username" || kind === "email" || kind === "subdomain" || kind === "customDomain"
    ? kind
    : null;
}

/**
 * Description: Delete a profile image file that is no longer used, best effort.
 * Input: The storage key (or null) and a word for the log.
 * Output: Nothing; a failure is logged, never thrown.
 * Use case: updateTenantProfile (old image after a save, new image after a failure).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
async function discardFile(key: string | null, why: string): Promise<void> {
  if (!key) return;
  await deleteStoredFile(key).catch((error: unknown) => {
    console.error(`[tenants] could not remove ${why} profile image: ${describeError(error)}`);
  });
}

/**
 * Description: Turn a tenant-database admin update problem into the edit result.
 * Input: The problem.
 * Output: A username/email field error, "admin not found" or an unavailable message;
 *   nothing was changed in any case.
 * Use case: updateTenantProfile.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-17
 */
function adminSyncFailure(outcome: Exclude<AdminRowOutcome, { ok: true }>): UpdateTenantResult {
  const { problem, conflicts } = outcome;
  // Preserve existing account wording; registration reservations use the shared policy.
  if (conflicts?.username === "pending" || conflicts?.username === "rejected" ||
      conflicts?.email === "pending" || conflicts?.email === "rejected") {
    return { ok: false, reason: "validation", fieldErrors: identityConflictErrors(conflicts) };
  }
  switch (problem) {
    case "username_taken":
      return {
        ok: false,
        reason: "validation",
        fieldErrors: { username: "Another user in the tenant's database already has this user name." },
      };
    case "email_taken":
      return {
        ok: false,
        reason: "validation",
        fieldErrors: { email: "Another user in the tenant's database already has this email address." },
      };
    case "missing":
      return {
        ok: false,
        reason: "invalid_state",
        message: "The tenant admin account was not found in the tenant's database. Nothing was changed.",
      };
    default:
      return {
        ok: false,
        reason: "unavailable",
        message: "The tenant's database could not be updated, so nothing was changed. Try again shortly.",
      };
  }
}

/**
 * Description: Build the control-plane update for the changed columns.
 * Input: The changed fields, the new values and the new image key.
 * Output: The Prisma update data; updated_at is always set, so the row is touched (and checked).
 * Use case: updateTenantProfile.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function tenantData(
  changed: ReadonlySet<UpdateTenantField>,
  next: EditValues,
  newImageKey: string | null,
): Prisma.TenantUpdateManyMutationInput {
  const data: Prisma.TenantUpdateManyMutationInput = { updatedAt: new Date() };
  if (changed.has("fullName")) data.name = next.fullName;
  if (changed.has("phone")) data.phone = next.phone;
  if (changed.has("username")) data.adminUsername = next.username;
  if (changed.has("email")) data.contactEmail = next.email;
  if (changed.has("profileImage")) data.profileImageKey = newImageKey;
  return data;
}

// ---------------------------------------------------------------------------

/**
 * Description: Apply an edit to a tenant (§8.4).
 * Input: The tenant id, the raw request values, the acting owner and test dependencies.
 * Output: ok with the changed fields and whether DNS is pending, field errors (like
 *   the create form), or a refusal (not found, setup running, unavailable).
 *   Desired identity and recovery state commit before the locked tenant write.
 *   An expected version rejects overlapping stale profile submissions.
 * Use case: updateTenantAction (the edit form).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-17
 */
export async function updateTenantProfile(
  id: string,
  input: UpdateTenantInput,
  actor: TenantActor,
  deps: UpdateTenantDeps = {},
): Promise<UpdateTenantResult> {
  if (!isUuid(id)) return NOT_FOUND;
  const baseDomain = getEnv().platformBaseDomain;
  const validation = validateEdit(input, baseDomain);
  if (!validation.ok) return { ok: false, reason: "validation", fieldErrors: validation.fieldErrors };
  const next = validation.value;

  let current: EditableRow | null;
  try {
    current = await loadEditable(id);
  } catch (error) {
    console.error(`[tenants] could not read tenant ${id} for an edit: ${describeError(error)}`);
    return UNAVAILABLE;
  }
  if (!current) return NOT_FOUND;
  // The runner reads the admin's names and the domain while it works.
  if (current.status === "provisioning") return BUSY;

  // Non-identity/no-change submissions first finish the saved desired identity.
  // An explicit name correction may replace a pending desired name instead: an
  // applicant could have reserved it after the interrupted tenant rollback.
  const correctsPendingIdentity = next.username !== current.adminUsername || next.email !== current.contactEmail;
  if (current.adminIdentitySyncPending && !correctsPendingIdentity) {
    try {
      const recovered = await updateTenantAdminRow(id, current.adminUsername, {});
      if (!recovered.ok) return adminSyncFailure(recovered);
      current = await loadEditable(id);
      if (!current) return NOT_FOUND;
      if (current.status === "provisioning") return BUSY;
    } catch (error) {
      console.error(`[tenants] tenant ${id}: identity recovery could not finish: ${describeError(error)}`);
      return UNAVAILABLE;
    }
  }

  const changedList = changedFields(current, next);
  if (changedList.length === 0) return { ok: true, tenantId: id, changed: [], dnsPending: false };
  const changed = new Set(changedList);

  // Names still free (other tenants only). The unique indexes stay the guarantee.
  try {
    const fieldErrors = await takenNames(id, next, changed);
    if (Object.keys(fieldErrors).length > 0) return { ok: false, reason: "validation", fieldErrors };
  } catch (error) {
    console.error(`[tenants] availability check for an edit failed: ${describeError(error)}`);
    return UNAVAILABLE;
  }

  // A new image is stored before the transaction (files are not transactional).
  let newImageKey: string | null = null;
  if (next.image.action === "replace") {
    try {
      const stored = await storeProfileImage(id, next.image.bytes);
      if (!stored.ok) return { ok: false, reason: "validation", fieldErrors: { profileImage: stored.error } };
      newImageKey = stored.value;
    } catch (error) {
      console.error(`[tenants] could not store a profile image: ${describeError(error)}`);
      return { ok: false, reason: "unavailable", message: "The profile image could not be saved. Try again." };
    }
  }

  const adminChange: AdminRowChange = {
    ...(changed.has("username") ? { username: next.username } : {}),
    ...(changed.has("email") ? { email: next.email } : {}),
  };
  const syncAdmin =
    current.provisioningSteps.length > 0 && (changed.has("username") || changed.has("email"));

  const subdomainRow = domainOf(current, "subdomain");
  const customRow    = domainOf(current, "custom");
  let stage: InsertStage = "other";
  let controlCommitted   = false;
  // Capture the narrowed row so the callback always checks this exact snapshot.
  const snapshot = current;
  /**
   * Description: Save the profile and versioned desired admin identity atomically.
   * Input: The immutable admin UUID when synchronizing a provisioned identity.
   * Output: The desired revision; marks a durable commit for failure handling.
   * Use case: Tenant identity lock callback, or a control-only profile edit.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-17
   * Last modified: 2026-10-17
   */
  const commitProfile = async (adminId?: string): Promise<number> => {
    await getControlDb().$transaction(async (tx) => {
      stage = "tenant";
      // Conditional: setup may have started since the tenant was read.
      const { count } = await tx.tenant.updateMany({
        where: { id, status: { not: "provisioning" }, adminIdentityVersion: snapshot.adminIdentityVersion },
        data: {
          ...tenantData(changed, next, newImageKey),
          adminIdentityVersion: { increment: 1 },
          ...(adminId ? { adminUserId: adminId, adminIdentitySyncPending: true } : {}),
        },
      });
      if (count !== 1) throw new StateMismatch();

      if (changed.has("subdomain")) {
        stage = "subdomain";
        // `slug` keeps the first label: it is the tenant's stable identifier, not its address.
        const reset = { status: "pending", verifiedAt: null, lastCheckedAt: null, lastCheckError: null } as const;
        if (subdomainRow) {
          await tx.tenantDomain.update({ where: { id: subdomainRow.id }, data: { hostname: next.subdomain, ...reset } });
        } else {
          await tx.tenantDomain.create({ data: { tenantId: id, type: "subdomain", hostname: next.subdomain, ...reset } });
        }
      }

      if (changed.has("customDomain")) {
        stage = "customDomain";
        if (next.customDomain === null) {
          if (customRow) await tx.tenantDomain.delete({ where: { id: customRow.id } });
        } else {
          // A new host needs a new proof of control: fresh token, pending again.
          const pending = {
            hostname: next.customDomain,
            status: "pending",
            verificationToken: generateVerificationToken(),
            verifiedAt: null,
            lastCheckedAt: null,
            lastCheckError: null,
          } as const;
          if (customRow) {
            await tx.tenantDomain.update({ where: { id: customRow.id }, data: pending });
          } else {
            await tx.tenantDomain.create({ data: { tenantId: id, type: "custom", ...pending } });
          }
        }
      }

      stage = "other";
      await recordAudit(tx, {
        ...ownerAudit(actor),
        tenantId: id,
        action: "tenant.updated",
        targetType: "tenant",
        targetId: id,
        // The names of the changed fields, never their values.
        metadata: { fields: changedList },
      });
    });
    controlCommitted = true;
    return snapshot.adminIdentityVersion + 1;
  };
  try {
    if (syncAdmin) {
      const outcome = await updateTenantAdminRow(id, current.adminUsername, adminChange, commitProfile);
      if (!outcome.ok) {
        if (controlCommitted) {
          // The new image is referenced by the committed profile: retain it.
          if (changed.has("profileImage")) await discardFile(current.profileImageKey, "the previous");
          return { ok: false, reason: "unavailable", message: "The profile was saved, but the administrator identity is waiting to synchronize. Retry the edit to finish synchronization." };
        }
        await discardFile(newImageKey, "an unused");
        return adminSyncFailure(outcome);
      }
    } else {
      await commitProfile();
    }
  } catch (error) {
    if (!controlCommitted) await discardFile(newImageKey, "an unused");
    if (error instanceof StateMismatch) {
      const exists = await getControlDb().tenant.count({ where: { id } }).catch(() => 1);
      return exists === 0 ? NOT_FOUND : { ok: false, reason: "invalid_state", message: "This tenant changed while the form was being saved. Reload the form and try again." };
    }
    const kind  = uniqueViolationField(error, stage);
    const field = kind ? editField(kind) : null;
    if (kind && field) return { ok: false, reason: "validation", fieldErrors: { [field]: TAKEN_MESSAGES[kind] } };
    console.error(`[tenants] could not update tenant ${id}: ${describeError(error)}`);
    return UNAVAILABLE;
  }

  // The old file goes only once the row no longer points to it.
  if (changed.has("profileImage")) await discardFile(current.profileImageKey, "the previous");

  let dnsPending = changed.has("customDomain") && next.customDomain !== null;
  if (changed.has("subdomain")) {
    const check = await checkSubdomainRow(id, next.subdomain, deps.dnsResolver);
    if (check.status !== "active") dnsPending = true;
  }
  return { ok: true, tenantId: id, changed: changedList, dnsPending };
}

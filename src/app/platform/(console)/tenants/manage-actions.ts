"use server";
/**
 * Server Actions for an existing tenant: editing it, changing its
 * credentials and checking its domains (docs/tenant-management.md §8.4,
 * §8.5, §7.2, §8.7).
 *
 * Same rules as actions.ts: each is a public HTTP endpoint, so the session and
 * the action's privilege are checked first (authorizePlatformAction; refusals
 * are audited as authz.denied), every argument is re-validated (types included), the service
 * does the work, and the result is a plain object with safe messages. No
 * result carries a password, except a generated master password, once.
 */
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { PlatformPermissionKey } from "@/lib/authz/catalog";
import { authorizePlatformAction } from "@/lib/authz/platform";
import { clientIpFromForwardedFor } from "@/lib/platform-auth/rate-limit";
import { MAX_PROFILE_IMAGE_BYTES } from "@/lib/storage/image";
import {
  type ProfileImageChange,
  recheckSubdomain,
  resetMasterPassword,
  rotateDatabasePassword,
  type TenantActor,
  updateExistingDatabasePassword,
  updateTenantProfile,
  verifyCustomDomain,
} from "@/lib/tenants/service";
import type {
  DatabasePasswordActionResult,
  DomainCheckActionResult,
  ForbiddenFailure,
  ResetMasterPasswordActionResult,
  ResetMasterPasswordInput,
  UpdateTenantActionState,
} from "./action-types";

const TENANTS_PATH = "/platform/tenants";

/**
 * Description: Authorize a manage action by privilege and identify its actor.
 * Input: The platform privilege the action needs.
 * Output: { ok: true, actor } (owner id from the session and the client IP), or
 *   { ok: false, error } with the friendly refusal (audited as authz.denied);
 *   a signed-out caller is redirected to the login page.
 * Use case: Every manage Server Action, before it reads or changes anything.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
async function authorizeActor(
  permission: PlatformPermissionKey,
): Promise<{ ok: true; actor: TenantActor } | { ok: false; error: string }> {
  const ipAddress     = clientIpFromForwardedFor((await headers()).get("x-forwarded-for"));
  const authorization = await authorizePlatformAction(permission, { ipAddress });
  if (!authorization.ok) return { ok: false, error: authorization.error };
  return { ok: true, actor: { ownerId: authorization.session.owner.id, ipAddress } };
}

/**
 * Description: Build the refusal of an action whose privilege is missing.
 * Input: The friendly message from authorizePlatformAction.
 * Output: The shared ForbiddenFailure shape ({ ok: false, reason: "forbidden", message }).
 * Use case: Credential and domain actions of this file.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function forbidden(message: string): ForbiddenFailure {
  return { ok: false, reason: "forbidden", message };
}

/**
 * Description: Read an untrusted Server Action value as text.
 * Input: Any value.
 * Output: The string, or "" for anything else.
 * Use case: Every manage Server Action.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Description: Refresh the server-rendered pages that show a tenant.
 * Input: The tenant id.
 * Output: Nothing; the directory, details and edit pages re-render on next visit.
 * Use case: After successful edits, credential and DNS actions.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function revalidateTenant(tenantId: string): void {
  revalidatePath(TENANTS_PATH);
  revalidatePath(`${TENANTS_PATH}/${tenantId}`);
  revalidatePath(`${TENANTS_PATH}/${tenantId}/edit`);
}

const IMAGE_TOO_LARGE = "The image is larger than 2 MB. Choose a smaller image.";

/**
 * Description: Read the edit form's image change.
 * Input: The submitted FormData.
 * Output: keep, remove, or replace with the file's bytes; an error for a missing or
 *   oversized (> 2 MB) file; an unknown action is passed on and refused by the service.
 * Use case: updateTenantAction.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
async function profileImageChange(
  formData: FormData,
): Promise<{ ok: true; change: ProfileImageChange } | { ok: false; error: string }> {
  const action = text(formData.get("profileImageAction"));
  if (action === "keep" || action === "remove") return { ok: true, change: { action } };
  if (action !== "replace") return { ok: true, change: { action } as unknown as ProfileImageChange };
  const file = formData.get("profileImage");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image to upload, or keep the current one." };
  }
  // Checked before reading, so an oversized upload is never buffered twice.
  if (file.size > MAX_PROFILE_IMAGE_BYTES) return { ok: false, error: IMAGE_TOO_LARGE };
  return { ok: true, change: { action: "replace", bytes: new Uint8Array(await file.arrayBuffer()) } };
}

// ---------------------------------------------------------------------------

/**
 * Description: Save the edit form.
 * Input: The tenant id (bound), the previous state and the submitted FormData.
 * Output: "saved" with the changed fields and whether DNS is pending, or "error"
 *   with field errors or a form message.
 * Use case: The edit form (useActionState).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
export async function updateTenantAction(
  tenantId: string,
  _previousState: UpdateTenantActionState,
  formData: FormData,
): Promise<UpdateTenantActionState> {
  const authorization = await authorizeActor("platform.tenants.edit");
  if (!authorization.ok) return { status: "error", formError: authorization.error, fieldErrors: {} };
  const { actor } = authorization;
  const id        = text(tenantId);
  if (!(formData instanceof FormData)) {
    return { status: "error", formError: "The form could not be read. Reload the page and try again.", fieldErrors: {} };
  }
  /**
   * Description: Read one FormData field as text.
   * Input: The field name.
   * Output: The text, or "".
   * Use case: updateTenantAction.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  const field = (name: string): string => text(formData.get(name));

  const image = await profileImageChange(formData);
  if (!image.ok) return { status: "error", fieldErrors: { profileImage: image.error } };

  const result = await updateTenantProfile(
    id,
    {
      fullName: field("fullName"),
      phone: field("phone"),
      email: field("email"),
      username: field("username"),
      subdomain: field("subdomain"),
      customDomain: field("customDomain"),
      profileImage: image.change,
    },
    actor,
  );

  if (!result.ok) {
    return result.reason === "validation"
      ? { status: "error", fieldErrors: result.fieldErrors }
      : { status: "error", formError: result.message, fieldErrors: {} };
  }
  if (result.changed.length > 0) revalidateTenant(id);
  return { status: "saved", tenantId: result.tenantId, changed: result.changed, dnsPending: result.dnsPending };
}

/**
 * Description: Reset the tenant admin's master password.
 * Input: The tenant id and the request (auto, or manual with a password).
 * Output: ok (with the generated password once, Auto) or a safe failure.
 * Use case: Reset master password dialog.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
export async function resetMasterPasswordAction(
  tenantId: string,
  input: ResetMasterPasswordInput,
): Promise<ResetMasterPasswordActionResult> {
  const authorization = await authorizeActor("platform.tenants.credentials");
  if (!authorization.ok) return forbidden(authorization.error);
  const { actor } = authorization;

  const id     = text(tenantId);
  const values = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  // Only the two documented shapes reach the service; anything else is refused there.
  const request = (
    values.mode === "manual"
      ? { mode: "manual", password: text(values.password) }
      : { mode: values.mode === "auto" ? "auto" : "" }
  ) as ResetMasterPasswordInput;
  const result = await resetMasterPassword(id, request, actor);
  if (result.ok) revalidateTenant(id);
  return result;
}

/**
 * Description: Rotate a provisioned tenant's database password.
 * Input: The tenant id.
 * Output: ok or a safe failure.
 * Use case: Rotate password confirmation.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
export async function rotateDatabasePasswordAction(tenantId: string): Promise<DatabasePasswordActionResult> {
  const authorization = await authorizeActor("platform.tenants.credentials");
  if (!authorization.ok) return forbidden(authorization.error);
  const { actor } = authorization;

  const id     = text(tenantId);
  const result = await rotateDatabasePassword(id, actor);
  if (result.ok) revalidateTenant(id);
  return result;
}

/**
 * Description: Store a new password of an existing database's login.
 * Input: The tenant id and the password.
 * Output: ok or a safe failure (the password is tested before it is saved).
 * Use case: Update password confirmation.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
export async function updateDatabasePasswordAction(
  tenantId: string,
  password: string,
): Promise<DatabasePasswordActionResult> {
  const authorization = await authorizeActor("platform.tenants.credentials");
  if (!authorization.ok) return forbidden(authorization.error);
  const { actor } = authorization;

  const id     = text(tenantId);
  const result = await updateExistingDatabasePassword(id, text(password), actor);
  if (result.ok) revalidateTenant(id);
  return result;
}

/**
 * Description: Run the custom domain's DNS check.
 * Input: The tenant id.
 * Output: ok or the reason; a failed DNS check still revalidates (its time and
 *   reason are recorded).
 * Use case: Check DNS on the details page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
export async function verifyCustomDomainAction(tenantId: string): Promise<DomainCheckActionResult> {
  const authorization = await authorizeActor("platform.tenants.edit");
  if (!authorization.ok) return forbidden(authorization.error);
  const { actor } = authorization;

  const id     = text(tenantId);
  const result = await verifyCustomDomain(id, actor);
  // A failed check records its time and reason on the row too.
  if (result.ok || result.reason === "dns") revalidateTenant(id);
  return result;
}

/**
 * Description: Re-run the subdomain's DNS check.
 * Input: The tenant id.
 * Output: ok or the reason (revalidated like the custom domain check).
 * Use case: Check again on the details page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
export async function recheckSubdomainAction(tenantId: string): Promise<DomainCheckActionResult> {
  const authorization = await authorizeActor("platform.tenants.edit");
  if (!authorization.ok) return forbidden(authorization.error);
  const { actor } = authorization;

  const id     = text(tenantId);
  const result = await recheckSubdomain(id, actor);
  if (result.ok || result.reason === "dns") revalidateTenant(id);
  return result;
}

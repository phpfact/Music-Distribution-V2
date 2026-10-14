"use server";
/**
 * Server Actions for an existing tenant: editing it, changing its
 * credentials and checking its domains (docs/tenant-management.md §8.4,
 * §8.5, §7.2, §8.7).
 *
 * Same rules as actions.ts: each is a public HTTP endpoint, so the session is
 * checked first, every argument is re-validated (types included), the service
 * does the work, and the result is a plain object with safe messages. No
 * result carries a password, except a generated master password, once.
 */
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
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
  ResetMasterPasswordActionResult,
  ResetMasterPasswordInput,
  UpdateTenantActionState,
} from "./action-types";

const TENANTS_PATH = "/platform/tenants";

/** The signed-in owner (or a redirect to the login page) and the client address. */
async function currentActor(): Promise<TenantActor> {
  const { owner } = await requirePlatformOwner();
  const ipAddress = clientIpFromForwardedFor((await headers()).get("x-forwarded-for"));
  return { ownerId: owner.id, ipAddress };
}

/** Anything that is not a string (a file, a missing field) reads as "". */
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The list, the details page and the edit page all show what changed. */
function revalidateTenant(tenantId: string): void {
  revalidatePath(TENANTS_PATH);
  revalidatePath(`${TENANTS_PATH}/${tenantId}`);
  revalidatePath(`${TENANTS_PATH}/${tenantId}/edit`);
}

const IMAGE_TOO_LARGE = "The image is larger than 2 MB. Choose a smaller image.";

/**
 * The image change the form asks for. `replace` needs a non-empty file; an
 * unknown action is passed on as such and refused by the service.
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

export async function updateTenantAction(
  tenantId: string,
  _previousState: UpdateTenantActionState,
  formData: FormData,
): Promise<UpdateTenantActionState> {
  const actor = await currentActor();
  const id = text(tenantId);
  if (!(formData instanceof FormData)) {
    return { status: "error", formError: "The form could not be read. Reload the page and try again.", fieldErrors: {} };
  }
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

export async function resetMasterPasswordAction(
  tenantId: string,
  input: ResetMasterPasswordInput,
): Promise<ResetMasterPasswordActionResult> {
  const actor = await currentActor();
  const id = text(tenantId);
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

export async function rotateDatabasePasswordAction(tenantId: string): Promise<DatabasePasswordActionResult> {
  const actor = await currentActor();
  const id = text(tenantId);
  const result = await rotateDatabasePassword(id, actor);
  if (result.ok) revalidateTenant(id);
  return result;
}

export async function updateDatabasePasswordAction(
  tenantId: string,
  password: string,
): Promise<DatabasePasswordActionResult> {
  const actor = await currentActor();
  const id = text(tenantId);
  const result = await updateExistingDatabasePassword(id, text(password), actor);
  if (result.ok) revalidateTenant(id);
  return result;
}

export async function verifyCustomDomainAction(tenantId: string): Promise<DomainCheckActionResult> {
  const actor = await currentActor();
  const id = text(tenantId);
  const result = await verifyCustomDomain(id, actor);
  // A failed check records its time and reason on the row too.
  if (result.ok || result.reason === "dns") revalidateTenant(id);
  return result;
}

export async function recheckSubdomainAction(tenantId: string): Promise<DomainCheckActionResult> {
  const actor = await currentActor();
  const id = text(tenantId);
  const result = await recheckSubdomain(id, actor);
  if (result.ok || result.reason === "dns") revalidateTenant(id);
  return result;
}

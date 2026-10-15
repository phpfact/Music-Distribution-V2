"use server";
/**
 * Tenant Management Server Actions (docs/tenant-management.md §8.7).
 *
 * Each one is a public HTTP endpoint, so each is thin and assumes nothing:
 * the session is checked first, every argument is re-validated (types
 * included), the service does the work, and the result is a plain object
 * with safe messages. No result carries a password, except the generated
 * master password of a successful auto-mode create.
 */
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { clientIpFromForwardedFor } from "@/lib/platform-auth/rate-limit";
import { MAX_PROFILE_IMAGE_BYTES } from "@/lib/storage/image";
import {
  createTenant,
  type CreateTenantInput,
  previewGeneratedValues,
  reactivateTenant,
  retryProvisioning,
  startProvisioning,
  suspendTenant,
  type TenantActor,
  testDatabaseConnection,
} from "@/lib/tenants/service";
import type {
  ConnectionTestResult,
  CreateTenantActionState,
  PreviewResult,
  TenantLifecycleActionResult,
  TestConnectionInput,
} from "./action-types";

const TENANTS_PATH = "/platform/tenants";

/** The signed-in owner (or a redirect to the login page) and the client address. */
async function currentActor(): Promise<TenantActor> {
  const { owner } = await requirePlatformOwner();
  const ipAddress = clientIpFromForwardedFor((await headers()).get("x-forwarded-for"));
  // The limiter's "unknown" bucket is not an address; the audit stores NULL for it anyway.
  return { ownerId: owner.id, ipAddress };
}

/** Anything that is not a string (a file, a missing field) reads as "". */
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function revalidateTenant(tenantId: string): void {
  revalidatePath(TENANTS_PATH);
  revalidatePath(`${TENANTS_PATH}/${tenantId}`);
}

// ---------------------------------------------------------------------------

export async function createTenantAction(
  _previousState: CreateTenantActionState,
  formData: FormData,
): Promise<CreateTenantActionState> {
  const actor = await currentActor();
  const field = (name: string): string =>
    formData instanceof FormData ? text(formData.get(name)) : "";

  // An empty file input submits a zero-byte File: that means "no image".
  const file = formData instanceof FormData ? formData.get("profileImage") : null;
  let profileImage: CreateTenantInput["profileImage"] = null;
  if (file instanceof File && file.size > 0) {
    // Checked before reading, so an oversized upload is never buffered twice.
    if (file.size > MAX_PROFILE_IMAGE_BYTES) {
      return {
        status: "error",
        fieldErrors: { profileImage: "The image is larger than 2 MB. Choose a smaller image." },
      };
    }
    profileImage = { bytes: new Uint8Array(await file.arrayBuffer()) };
  }

  const result = await createTenant(
    {
      fullName: field("fullName"),
      phone: field("phone"),
      username: field("username"),
      email: field("email"),
      masterPassword: field("masterPassword"),
      databaseName: field("databaseName"),
      databaseUser: field("databaseUser"),
      databasePassword: field("databasePassword"),
      databasePort: field("databasePort"),
      subdomain: field("subdomain"),
      customDomain: field("customDomain"),
      // One Auto-Generate / Manual switch per form section.
      loginMode: field("loginMode"),
      databaseCredentialMode: field("databaseCredentialMode"),
      subdomainMode: field("subdomainMode"),
      databaseMode: field("databaseMode"),
      profileImage,
    },
    actor,
  );

  if (!result.ok) {
    if (result.reason === "validation") {
      return {
        status: "error",
        fieldErrors: result.fieldErrors,
        ...(result.checks
          ? {
              checks: result.checks,
              formError: "The existing database did not pass the checks. Fix the failing ones, then try again.",
            }
          : {}),
      };
    }
    return { status: "error", formError: result.message, fieldErrors: {} };
  }

  const { tenantId } = result;
  // Setup runs after the response is sent; the details page polls its progress.
  after(() => startProvisioning(tenantId, actor));
  revalidatePath(TENANTS_PATH);
  return result.generatedMasterPassword
    ? { status: "created", tenantId, generatedMasterPassword: result.generatedMasterPassword }
    : { status: "created", tenantId };
}

export async function previewTenantValuesAction(fullName: string): Promise<PreviewResult> {
  const actor = await currentActor();
  return previewGeneratedValues(text(fullName), actor);
}

export async function testDatabaseConnectionAction(
  input: TestConnectionInput,
): Promise<ConnectionTestResult> {
  const actor = await currentActor();
  const values = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  return testDatabaseConnection(
    {
      databaseName: text(values.databaseName),
      databaseUser: text(values.databaseUser),
      databasePassword: text(values.databasePassword),
      databasePort: text(values.databasePort),
    },
    actor,
  );
}

export async function suspendTenantAction(
  tenantId: string,
  reason: string,
): Promise<TenantLifecycleActionResult> {
  const actor = await currentActor();
  const id = text(tenantId);
  const result = await suspendTenant(id, text(reason), actor);
  if (result.ok) revalidateTenant(id);
  return result;
}

export async function reactivateTenantAction(tenantId: string): Promise<TenantLifecycleActionResult> {
  const actor = await currentActor();
  const id = text(tenantId);
  const result = await reactivateTenant(id, actor);
  if (result.ok) revalidateTenant(id);
  return result;
}

export async function retryProvisioningAction(tenantId: string): Promise<TenantLifecycleActionResult> {
  const actor = await currentActor();
  const id = text(tenantId);
  const result = await retryProvisioning(id, actor);
  if (result.ok) {
    after(() => startProvisioning(id, actor));
    revalidateTenant(id);
  }
  return result;
}

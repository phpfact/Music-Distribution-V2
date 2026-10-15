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
import { describeError } from "@/lib/platform-auth/session";
import { MAX_PROFILE_IMAGE_BYTES } from "@/lib/storage/image";
import { parseTenantCountPage, parseTenantCountSource } from "@/lib/tenants/rules";
import {
  createTenant,
  type CreateTenantInput,
  listTenantCountRecords,
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
  TenantCountRecordsResult,
  TenantLifecycleActionResult,
  TestConnectionInput,
} from "./action-types";

const TENANTS_PATH = "/platform/tenants";

/**
 * Description: Identify the signed-in owner and the client address for a tenant action.
 * Input: None (reads the session cookie and X-Forwarded-For).
 * Output: The actor (owner id from the session, never the request body, and IP);
 *   a signed-out caller is redirected to the login page.
 * Use case: Every tenant Server Action.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
async function currentActor(): Promise<TenantActor> {
  const { owner } = await requirePlatformOwner();
  const ipAddress = clientIpFromForwardedFor((await headers()).get("x-forwarded-for"));
  // The limiter's "unknown" bucket is not an address; the audit stores NULL for it anyway.
  return { ownerId: owner.id, ipAddress };
}

/**
 * Description: Read an untrusted Server Action value as text.
 * Input: Any value.
 * Output: The string, or "" for anything else (a file, a missing field).
 * Use case: Every tenant Server Action.
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
 * Output: Nothing; the directory and the details page re-render on next visit.
 * Use case: After successful lifecycle actions.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function revalidateTenant(tenantId: string): void {
  revalidatePath(TENANTS_PATH);
  revalidatePath(`${TENANTS_PATH}/${tenantId}`);
}

// ---------------------------------------------------------------------------

/**
 * Description: Create a tenant from the create form.
 * Input: The previous form state (unused) and the submitted FormData.
 * Output: "created" with the tenant id (and the generated master password once), or
 *   "error" with field errors, the failed checks and/or a form message. Setup is
 *   scheduled with after() once the response is sent.
 * Use case: The create form (useActionState).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function createTenantAction(
  _previousState: CreateTenantActionState,
  formData: FormData,
): Promise<CreateTenantActionState> {
  const actor = await currentActor();
  /**
   * Description: Read one FormData field as text.
   * Input: The field name.
   * Output: The text, or "" (also when FormData is not a FormData).
   * Use case: createTenantAction.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
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

/**
 * Description: Generate the Auto-Generate values for a full name.
 * Input: The typed full name.
 * Output: The preview values or a rate-limit/unavailable message.
 * Use case: The create form's debounced preview and Regenerate.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function previewTenantValuesAction(fullName: string): Promise<PreviewResult> {
  const actor = await currentActor();
  return previewGeneratedValues(text(fullName), actor);
}

/**
 * Description: Test an existing database's connection without saving.
 * Input: The typed database name, user, password and port (untrusted).
 * Output: The check list, field errors, or a rate-limit/unavailable message.
 * Use case: The create form's Test connection button.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function testDatabaseConnectionAction(
  input: TestConnectionInput,
): Promise<ConnectionTestResult> {
  const actor  = await currentActor();
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

/**
 * Description: Suspend a tenant.
 * Input: The tenant id and the reason.
 * Output: ok, or a safe refusal; the pages are revalidated on success.
 * Use case: The Suspend confirmation (directory menu, details page).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function suspendTenantAction(
  tenantId: string,
  reason: string,
): Promise<TenantLifecycleActionResult> {
  const actor  = await currentActor();
  const id     = text(tenantId);
  const result = await suspendTenant(id, text(reason), actor);
  if (result.ok) revalidateTenant(id);
  return result;
}

/**
 * Description: Reactivate a suspended tenant.
 * Input: The tenant id.
 * Output: ok, or a safe refusal; the pages are revalidated on success.
 * Use case: The Reactivate confirmation.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function reactivateTenantAction(tenantId: string): Promise<TenantLifecycleActionResult> {
  const actor  = await currentActor();
  const id     = text(tenantId);
  const result = await reactivateTenant(id, actor);
  if (result.ok) revalidateTenant(id);
  return result;
}

/**
 * Description: Retry a tenant's failed or interrupted setup.
 * Input: The tenant id.
 * Output: ok (setup is scheduled after the response), or a safe refusal.
 * Use case: The Retry setup confirmation.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function retryProvisioningAction(tenantId: string): Promise<TenantLifecycleActionResult> {
  const actor  = await currentActor();
  const id     = text(tenantId);
  const result = await retryProvisioning(id, actor);
  if (result.ok) {
    after(() => startProvisioning(id, actor));
    revalidateTenant(id);
  }
  return result;
}

// The message of a count-details list that could not be read (details go to the log).
const COUNT_RECORDS_FAILED = "The tenants could not be loaded right now. Try again.";
// The message for a manipulated request (a normal client never sends one).
const COUNT_RECORDS_INVALID = "This list is not available.";

/**
 * Description: Load one page of the tenants behind a count shown in the console.
 * Input: The count's source (summary category, or the directory search and
 *   status) and the page number; both untrusted and validated here.
 * Output: The page's tenants (id, name, status, created date only), the total
 *   and the page count; or a safe message on invalid input or a database error.
 * Use case: Count-details dialogs of the dashboard and the tenant directory
 *   (CLAUDE.md count transparency), loaded on demand with server-side paging.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function loadTenantCountRecordsAction(
  source: unknown,
  page: unknown,
): Promise<TenantCountRecordsResult> {
  // Step 1: only a signed-in platform owner (otherwise a redirect to login).
  await requirePlatformOwner();

  // Step 2: validate both arguments; this endpoint is public HTTP.
  const parsedSource = parseTenantCountSource(source);
  if (!parsedSource) return { ok: false, message: COUNT_RECORDS_INVALID };
  const pageNumber = parseTenantCountPage(page);

  try {
    // Step 3: read the page from the database (pagination in SQL).
    const result = await listTenantCountRecords(parsedSource, pageNumber);

    // Step 4: send only what the dialog lists; no email, phone or username.
    return {
      ok: true,
      rows: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        createdAt: row.createdAt,
      })),
      total: result.total,
      page: result.page,
      pageCount: result.pageCount,
      pageSize: result.pageSize,
    };
  } catch (error) {
    // The cause stays in the server log; the owner sees a friendly message.
    console.error(`[tenants] could not load count records: ${describeError(error)}`);
    return { ok: false, message: COUNT_RECORDS_FAILED };
  }
}

"use server";
/**
 * Server Actions of the tenant's Customers module
 * (.vibe/memory/customer-management.md).
 *
 * Each action is a public HTTP endpoint, so each one first authorizes its EXACT
 * privilege with authorizeTenantAction (session of this Host's tenant, CURRENT
 * role, module switched on; a refusal is audited as authz.denied) and only
 * then calls ONE service function with the Host-resolved tenant database.
 * Nothing from the browser decides the tenant, the role or the customer's scope.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { TenantPermissionKey } from "@/lib/authz/catalog";
import { requestIpAddress } from "@/lib/authz/page-support";
import { authorizeTenantAction } from "@/lib/authz/workspace";
import { describeError } from "@/lib/platform-auth/session";
import {
  CUSTOMER_FIELD_ORDER,
  parseCustomerFilter,
  type CustomerActionResult,
  type CustomerFormState,
  type CustomerRecordsResult,
} from "@/lib/workspace/customer-rules";
import { createCustomer, listCustomers, setCustomerStatus, type CustomerActor } from "@/lib/workspace/customers";
import type { TenantArea } from "@/lib/workspace/guards";
import { parseRegistrationPage } from "@/lib/workspace/rules";
import { TENANT_CUSTOMERS_PATH, TENANT_DASHBOARD_PATH, TENANT_REGISTRATIONS_PATH } from "../navigation";

/**
 * Description: Authorize one Customers action by its tenant privilege.
 * Input: The privilege the action needs (tenant.customers.view / create / suspend).
 * Output: `{ ok: true, area, ipAddress }` or `{ ok: false, error }` with the
 *   friendly message; a refusal is audited as authz.denied (with the client
 *   address). A visitor without a tenant session is redirected to /login.
 * Use case: Every action in this file (hiding a button is never the protection).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
async function authorize(
  permission: TenantPermissionKey,
): Promise<{ ok: true; area: TenantArea; ipAddress: string } | { ok: false; error: string }> {
  const ipAddress     = await requestIpAddress();
  const authorization = await authorizeTenantAction(permission, { ipAddress });
  if (!authorization.ok) return { ok: false, error: authorization.error };
  return { ok: true, area: authorization.area, ipAddress };
}

/**
 * Description: Describe the signed-in staff user as the acting person.
 * Input: The tenant area (server-resolved session).
 * Output: The actor recorded in the audit log.
 * Use case: Create and suspend / reactivate.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
function staffActor(area: TenantArea): CustomerActor {
  return { type: "tenant_user", id: area.user.id };
}

/**
 * Description: Refresh the pages that show customers after a change.
 * Input: None.
 * Output: Nothing; a failure is only logged (the change itself is already saved).
 * Use case: Create and suspend / reactivate.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
function refreshCustomerPages(): void {
  try {
    // The list, the dashboard figure and the registrations page (same accounts) all show customers.
    revalidatePath(TENANT_CUSTOMERS_PATH);
    revalidatePath(TENANT_DASHBOARD_PATH);
    revalidatePath(TENANT_REGISTRATIONS_PATH);
  } catch (error) {
    console.error(`[customers] pages could not be refreshed: ${describeError(error)}`);
  }
}

/**
 * Description: Load the customers behind a summary figure (Total / Active / Suspended).
 * Input: The figure's filter ("all" | "active" | "disabled") and the page (untrusted).
 * Output: One page of customers, or a friendly error.
 * Use case: Count-details popups of /tenant/customers and the dashboard's
 *   "Active customers" figure (needs tenant.customers.view).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export async function loadTenantCustomerRecordsAction(filter: unknown, page: unknown): Promise<CustomerRecordsResult> {
  // Step 1: the exact privilege first.
  const authorization = await authorize("tenant.customers.view");
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const { area } = authorization;

  // Step 2: only known filters; any page number outside the range becomes 1.
  const status = parseCustomerFilter(filter);
  if (!status) return { ok: false, error: "Choose a valid group of customers." };

  // Step 3: one page from this tenant's database.
  try {
    return { ok: true, page: await listCustomers(area.db, { q: "", status, page: parseRegistrationPage(page) }) };
  } catch (error) {
    console.error(`[customers] tenant ${area.tenant.id}: records could not be loaded: ${describeError(error)}`);
    return { ok: false, error: "The customers could not be loaded right now. Try again." };
  }
}

/**
 * Description: Create a customer account of this tenant (Master Customer, primary, active).
 * Input: The previous form state (unused) and the FormData: full name, account
 *   type, username, email, password and confirmation. Any other key (role,
 *   parent, tenant, status…) is ignored.
 * Output: Field errors / a friendly form message, or a redirect to
 *   /tenant/customers with the "customer-created" notice.
 * Use case: "Add customer" form on /tenant/customers/new (needs tenant.customers.create).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export async function createTenantCustomerAction(_state: CustomerFormState, formData: FormData): Promise<CustomerFormState> {
  // Step 1: the exact privilege first (refusals are audited).
  const authorization = await authorize("tenant.customers.create");
  if (!authorization.ok) return { status: "error", fieldErrors: {}, formMessage: authorization.error };
  const { area, ipAddress } = authorization;

  // Step 2: read only the form's own fields (one value each; files and extras are ignored).
  const input: Record<string, unknown> = {};
  for (const name of CUSTOMER_FIELD_ORDER) input[name] = formData.get(name);

  // Step 3: ONE service call (validation, identity uniqueness, transaction, audit).
  const result = await createCustomer(area.db, area.tenant.id, input, staffActor(area), ipAddress);
  if (!result.ok) {
    return result.reason === "validation"
      ? { status: "error", fieldErrors: result.fieldErrors, ...(result.formMessage ? { formMessage: result.formMessage } : {}) }
      : { status: "error", fieldErrors: {}, formMessage: result.formMessage };
  }

  // Step 4: fresh pages, then back to the list with the fixed success notice.
  refreshCustomerPages();
  redirect(`${TENANT_CUSTOMERS_PATH}?notice=customer-created`);
}

/**
 * Description: Suspend an active / reactivate a suspended main customer of this tenant.
 * Input: The customer id and the change ("suspend" for a row shown active,
 *   "reactivate" for one shown suspended; both untrusted).
 * Output: The success message or a friendly error (not found, already in that
 *   state — "refresh the page", invalid change).
 * Use case: Suspend / Reactivate confirmations on /tenant/customers (needs tenant.customers.suspend).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export async function setTenantCustomerStatusAction(customerId: unknown, change: unknown): Promise<CustomerActionResult> {
  // Step 1: the exact privilege first (refusals are audited).
  const authorization = await authorize("tenant.customers.suspend");
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const { area, ipAddress } = authorization;

  // Step 2: ONE service call; the service validates the id and the change.
  const result = await setCustomerStatus(area.db, area.tenant.id, customerId, change, staffActor(area), ipAddress);
  if (result.ok) refreshCustomerPages();
  return result;
}

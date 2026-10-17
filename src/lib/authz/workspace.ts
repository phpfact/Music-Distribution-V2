import "server-only";
/**
 * Request guards of the tenant portal by privilege: tenant staff (Tenant and
 * Sub-Tenants) and customers (Customer and Sub-Customers)
 * (.vibe/memory/role-privilege-management.md, "Technical Notes").
 *
 * The session guards (src/lib/workspace/guards.ts) already attach the user's
 * effective privileges as `area.authz`; these functions are the entry points
 * for pages and Server Actions that need a privilege. Every action checks its
 * privilege itself; hidden navigation is only a convenience.
 */
import { requireCustomer, requireTenantUser, type CustomerArea, type TenantArea } from "@/lib/workspace/guards";
import type { CustomerPermissionKey, TenantPermissionKey } from "./catalog";
import { recordAuthzDenial } from "./denials";
import { forbiddenMessage } from "./resolver";

/** The outcome of authorizing one tenant-area action. */
export type TenantAuthorization = { ok: true; area: TenantArea } | { ok: false; error: string };

/** The outcome of authorizing one customer-area action. */
export type CustomerAuthorization = { ok: true; area: CustomerArea } | { ok: false; error: string };

/**
 * Description: Require a signed-in tenant staff user with their privileges.
 * Input: None (Host header and the tenant session cookie).
 * Output: The tenant area (workspace, user, `authz`); anyone without a valid
 *   tenant session is redirected to /login. A missing/disabled role still
 *   returns (empty privileges), so the page can show its access-denied state.
 * Use case: Tenant pages that check privileges (new code; requireTenantUser
 *   stays for the existing callers and returns the same area).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function requireTenantAccess(): Promise<TenantArea> {
  return requireTenantUser();
}

/**
 * Description: Require a signed-in customer user with their privileges.
 * Input: None (Host header and the customer session cookie).
 * Output: The customer area (workspace, user, customer, `authz`); anyone without
 *   a valid customer session — including users of a suspended customer or of a
 *   sub-customer whose main customer is suspended — is redirected to /login.
 * Use case: Customer pages that check privileges.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function requireCustomerAccess(): Promise<CustomerArea> {
  return requireCustomer();
}

/**
 * Description: Authorize one tenant-area Server Action by privilege.
 * Input: The tenant privilege the action needs and, optionally, the client
 *   address for the audit row.
 * Output: `{ ok: true, area }`, or `{ ok: false, error }` with a friendly
 *   message; a refusal writes an `authz.denied` audit row (actor tenant_user).
 *   Without a valid session it redirects to /login (never returns).
 * Use case: Every tenant Server Action, before it changes anything.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function authorizeTenantAction(
  permission: TenantPermissionKey,
  options: { ipAddress?: string | null } = {},
): Promise<TenantAuthorization> {
  // Step 1: session, user and fresh privileges (redirects when signed out).
  const area = await requireTenantAccess();

  // Step 2: deny by default.
  if (area.authz.can(permission)) return { ok: true, area };

  // Step 3: refused — audited, with a message that reveals nothing internal.
  await recordAuthzDenial({
    actorType: "tenant_user",
    actorId: area.user.id,
    tenantId: area.tenant.id,
    permission,
    roleState: area.authz.roleState,
    ipAddress: options.ipAddress,
  });
  return { ok: false, error: forbiddenMessage(area.authz) };
}

/**
 * Description: Authorize one customer-area Server Action by privilege.
 * Input: The customer privilege the action needs and, optionally, the client
 *   address for the audit row.
 * Output: `{ ok: true, area }`, or `{ ok: false, error }` with a friendly
 *   message; a refusal writes an `authz.denied` audit row (actor customer_user).
 *   Without a valid session it redirects to /login (never returns).
 * Use case: Every customer Server Action, before it changes anything.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function authorizeCustomerAction(
  permission: CustomerPermissionKey,
  options: { ipAddress?: string | null } = {},
): Promise<CustomerAuthorization> {
  // Step 1: session, user, customer scope and fresh privileges.
  const area = await requireCustomerAccess();

  // Step 2: deny by default.
  if (area.authz.can(permission)) return { ok: true, area };

  // Step 3: refused — audited, with a message that reveals nothing internal.
  await recordAuthzDenial({
    actorType: "customer_user",
    actorId: area.user.id,
    tenantId: area.tenant.id,
    permission,
    roleState: area.authz.roleState,
    ipAddress: options.ipAddress,
  });
  return { ok: false, error: forbiddenMessage(area.authz) };
}

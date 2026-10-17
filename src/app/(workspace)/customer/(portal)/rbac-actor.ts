/**
 * The area-specific parts of the Customer panel's role / Sub-Customer pages
 * and Server Actions (.vibe/memory/role-privilege-management.md, "Technical
 * Notes" → "RBAC pages (all panels)"): the panel's paths, the authorize call
 * and the actor builder. Everything around them is shared by all panels in
 * src/lib/authz/ (page-support.ts, management-actions.ts) and
 * src/components/rbac/screens/.
 *
 * The actor's scope is the signed-in user's MAIN customer, resolved on the
 * server; never an id from the browser.
 */
import "server-only";
import { customerActor, type CustomerAuthzActor } from "@/lib/authz/actor";
import type { CustomerPermissionKey } from "@/lib/authz/catalog";
import { MANAGEMENT_PRIVILEGES, type ManagementOperation } from "@/lib/authz/management-model";
import {
  actorOrFailure,
  PAGE_DENIED,
  pageActorOf,
  requestIpAddress,
  type AuthorizedActor,
  type PageActorResult,
} from "@/lib/authz/page-support";
import type { RbacPanelPaths } from "@/lib/authz/management-actions";
import { authorizeCustomerAction, requireCustomerAccess } from "@/lib/authz/workspace";
import { CUSTOMER_ROLES_PATH, CUSTOMER_SUB_CUSTOMERS_PATH } from "./navigation";

/** The customer RBAC list paths (roles, Sub-Customers). */
export const CUSTOMER_RBAC_PATHS: RbacPanelPaths = { roles: CUSTOMER_ROLES_PATH, users: CUSTOMER_SUB_CUSTOMERS_PATH };

/**
 * Description: Authorize a customer-area RBAC Server Action and build its actor.
 * Input: The exact customer privilege the action needs (e.g. "customer.sub_customers.create").
 * Output: `{ ok: true, actor }` (scope = the signed-in user's MAIN customer;
 *   fresh privileges; client IP), or `{ ok: false, error }` with the friendly
 *   refusal (audited as authz.denied) or failure (logged). Without a customer
 *   session the guard redirects to /login (never returns).
 * Use case: Every Server Action of /customer/roles and /customer/sub-customers.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function authorizeCustomerActor(permission: CustomerPermissionKey): Promise<AuthorizedActor<CustomerAuthzActor>> {
  // Step 1: the exact privilege, decided on the CURRENT role (deny by default, audited).
  const ipAddress     = await requestIpAddress();
  const authorization = await authorizeCustomerAction(permission, { ipAddress });
  if (!authorization.ok) return { ok: false, error: authorization.error };

  // Step 2: the actor; its customer scope is the main customer of the session user.
  return actorOrFailure(() => customerActor(authorization.area, { ipAddress }), permission);
}

/**
 * Description: Check a customer page's privilege and build the actor of the render.
 * Input: The management operation the page needs (e.g. "usersView" → customer.sub_customers.view).
 * Output: The actor; `denied` without the privilege (access-denied state,
 *   nothing read); `unavailable` when the actor could not be built (logged).
 *   Without a customer session the guard redirects to /login.
 * Use case: The `pageActor` of the customer bindings (rbac-bindings.ts).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function customerPageActor(operation: ManagementOperation): Promise<PageActorResult> {
  // Step 1: session of this host + the CURRENT privileges decide access.
  const area       = await requireCustomerAccess();
  const permission = MANAGEMENT_PRIVILEGES.customer[operation];
  if (!area.authz.can(permission)) return PAGE_DENIED;

  // Step 2: the actor (scope = the session user's main customer).
  return pageActorOf(() => customerActor(area), permission);
}

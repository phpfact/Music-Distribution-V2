/**
 * The area-specific parts of the Tenant panel's role / Sub-Tenant pages and
 * Server Actions (.vibe/memory/role-privilege-management.md, "Technical Notes"
 * → "RBAC pages (all panels)"): the panel's paths, the authorize call and the
 * actor builder. Everything around them is shared by all panels in src/lib/authz/
 * (page-support.ts, management-actions.ts) and src/components/rbac/screens/.
 *
 * The actor is built ONLY from server-resolved data (Host-resolved tenant,
 * session user, fresh privileges); no id, flag or scope from the browser.
 */
import "server-only";
import { tenantActor, type TenantAuthzActor } from "@/lib/authz/actor";
import type { TenantPermissionKey } from "@/lib/authz/catalog";
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
import { authorizeTenantAction, requireTenantAccess } from "@/lib/authz/workspace";
import { TENANT_ROLES_PATH, TENANT_USERS_PATH } from "./navigation";

/** The tenant RBAC list paths (roles, Sub-Tenants). */
export const TENANT_RBAC_PATHS: RbacPanelPaths = { roles: TENANT_ROLES_PATH, users: TENANT_USERS_PATH };

/**
 * Description: Authorize a tenant-area RBAC Server Action and build its actor.
 * Input: The exact tenant privilege the action needs (e.g. "tenant.roles.create").
 * Output: `{ ok: true, actor }` (tenant scope from the Host header, the
 *   signed-in staff user, fresh privileges, the client IP for audits), or
 *   `{ ok: false, error }` with the friendly refusal (audited as authz.denied)
 *   or failure (logged). Without a tenant session the guard redirects to
 *   /login (never returns).
 * Use case: Every Server Action of /tenant/roles and /tenant/users.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function authorizeTenantActor(permission: TenantPermissionKey): Promise<AuthorizedActor<TenantAuthzActor>> {
  // Step 1: the exact privilege, decided on the CURRENT role (deny by default, audited).
  const ipAddress     = await requestIpAddress();
  const authorization = await authorizeTenantAction(permission, { ipAddress });
  if (!authorization.ok) return { ok: false, error: authorization.error };

  // Step 2: the actor, built only from the server-resolved area.
  return actorOrFailure(() => tenantActor(authorization.area, { ipAddress }), permission);
}

/**
 * Description: Check a tenant page's privilege and build the actor of the render.
 * Input: The management operation the page needs (e.g. "usersView" → tenant.users.view).
 * Output: The actor; `denied` without the privilege (access-denied state,
 *   nothing read); `unavailable` when the actor could not be built (logged).
 *   Without a tenant session the guard redirects to /login.
 * Use case: The `pageActor` of the tenant bindings (rbac-bindings.ts).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function tenantPageActor(operation: ManagementOperation): Promise<PageActorResult> {
  // Step 1: session of this host + the CURRENT privileges decide access.
  const area       = await requireTenantAccess();
  const permission = MANAGEMENT_PRIVILEGES.tenant[operation];
  if (!area.authz.can(permission)) return PAGE_DENIED;

  // Step 2: the actor (scope from the server only).
  return pageActorOf(() => tenantActor(area), permission);
}

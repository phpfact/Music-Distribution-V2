/**
 * The area-specific parts of the platform role / Sub-Platform Owner pages and
 * Server Actions (.vibe/memory/role-privilege-management.md, "Technical Notes"
 * → "RBAC pages (all panels)"): the panel's paths, the authorize call and the
 * actor builder. Everything around them (client address, friendly failure, the
 * action bodies, the screens) is shared by all panels in src/lib/authz/
 * (page-support.ts, management-actions.ts) and src/components/rbac/screens/.
 */
import "server-only";
import type { PlatformPermissionKey } from "@/lib/authz/catalog";
import { platformActor, type PlatformAuthzActor } from "@/lib/authz/actor";
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
import { authorizePlatformAction, requirePlatformAccess } from "@/lib/authz/platform";
import { getNavItem } from "./navigation";

/** The platform RBAC list paths (the same hrefs the sidebar links to). */
export const PLATFORM_RBAC_PATHS: RbacPanelPaths = { roles: getNavItem("roles").href, users: getNavItem("users").href };

/**
 * Description: Authorize a platform RBAC Server Action and build its actor.
 * Input: The exact platform privilege the action needs.
 * Output: { ok: true, actor } — the actor carries the owner id, role, CURRENT
 *   effective privileges, disabled modules and the client address; or
 *   { ok: false, error } with a friendly message: a missing privilege is
 *   audited as `authz.denied` by authorizePlatformAction, a failure to build
 *   the actor is logged (actorOrFailure). A signed-out caller is redirected to
 *   the login page.
 * Use case: Every Server Action in roles/actions.ts and users/actions.ts.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function authorizePlatformActor(permission: PlatformPermissionKey): Promise<AuthorizedActor<PlatformAuthzActor>> {
  // Step 1: session + CURRENT privilege (redirects when signed out; refusal audited).
  const ipAddress     = await requestIpAddress();
  const authorization = await authorizePlatformAction(permission, { ipAddress });
  if (!authorization.ok) return { ok: false, error: authorization.error };

  // Step 2: the actor from server-resolved data only (a failure stays friendly).
  return actorOrFailure(() => platformActor(authorization, { ipAddress }), permission);
}

/**
 * Description: Check a platform page's privilege and build the actor of the render.
 * Input: The management operation the page needs (e.g. "rolesView"; mapped to
 *   the platform key, e.g. platform.roles.view).
 * Output: The actor; `denied` without the privilege (the shared screen shows
 *   the access-denied state, HTTP 200, nothing read); `unavailable` when the
 *   actor could not be built (logged; friendly notice). Signed out → login.
 * Use case: The `pageActor` of the platform bindings (rbac-bindings.ts).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function platformPageActor(operation: ManagementOperation): Promise<PageActorResult> {
  // Step 1: session and CURRENT privileges, checked on every request.
  const { access } = await requirePlatformAccess();
  const permission = MANAGEMENT_PRIVILEGES.platform[operation];
  if (!access.can(permission)) return PAGE_DENIED;

  // Step 2: the actor of this render.
  return pageActorOf(() => platformActor({ access }), permission);
}

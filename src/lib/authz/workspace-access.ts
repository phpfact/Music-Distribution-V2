import "server-only";
/**
 * Effective privileges of a tenant staff user or a customer user
 * (.vibe/memory/role-privilege-management.md).
 *
 * The role and its privilege keys arrive with the session itself
 * (validateUserSession reads them in the same query), so the only extra read
 * is the tenant's module switches in the control plane: one query, memoized
 * for one request (React `cache()`), never across requests.
 */
import { cache } from "react";
import { getControlDb, type ControlDb } from "@/lib/db/control";
import type { SessionArea, WorkspaceUser } from "@/lib/workspace/sessions";
import { resolveEffectiveAccess, type EffectiveAccess, type RoleSnapshot } from "./resolver";

/**
 * Description: Read the tenant and customer modules switched off for one tenant.
 * Input: The control database client (or transaction) and the tenant id (from
 *   the Host header resolution, never from the request body).
 * Output: The module keys of `tenant_module_settings` rows with enabled = false
 *   (an absent row means enabled; core modules are ignored later by the resolver).
 * Use case: getDisabledTenantModules and tests.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function loadDisabledTenantModules(
  db: Pick<ControlDb, "tenantModuleSetting">,
  tenantId: string,
): Promise<string[]> {
  const rows = await db.tenantModuleSetting.findMany({
    where: { tenantId, enabled: false },
    select: { moduleKey: true },
  });
  return rows.map((row) => row.moduleKey);
}

/**
 * Description: Read one tenant's disabled modules once per request.
 * Input: The tenant id.
 * Output: The disabled module keys (see loadDisabledTenantModules). Memoized for
 *   the current request only, so the tenant and customer guards share one query.
 * Use case: The tenant and customer guards (src/lib/workspace/guards.ts).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export const getDisabledTenantModules = cache(async (tenantId: string): Promise<string[]> => {
  return loadDisabledTenantModules(getControlDb(), tenantId);
});

/**
 * Description: Decide the effective privileges of a signed-in workspace user.
 * Input: The user (role snapshot and customer from validateUserSession), the
 *   area of the session (tenant → tenant domain, customer → customer domain)
 *   and the tenant's disabled module keys.
 * Output: The effective access. A missing/disabled role, a role of the other
 *   domain, or a custom customer role not owned by the user's MAIN customer
 *   (COALESCE(parent, customer)) yields an empty set.
 * Use case: The tenant and customer guards; tests.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function resolveWorkspaceAccess<A extends SessionArea>(
  user: Pick<WorkspaceUser, "role" | "customer">,
  area: A,
  disabledModules: Iterable<string>,
): EffectiveAccess<A> {
  const role = user.role;

  // Step 1: scope — a custom customer role counts only for users of the main
  // customer that owns it (the database trigger enforces the same rule).
  const mainCustomerId = user.customer ? (user.customer.parentId ?? user.customer.id) : null;
  const inScope        = !role || role.ownerCustomerId === null || role.ownerCustomerId === mainCustomerId;

  // Step 2: the role as the resolver sees it (its own domain is checked there).
  const snapshot: RoleSnapshot | null = role
    ? {
        id: role.id,
        domain: role.domain,
        status: role.status,
        systemKey: role.systemKey,
        permissionKeys: role.permissionKeys,
      }
    : null;

  // Step 3: the decision (pure, shared with the platform).
  return resolveEffectiveAccess({ domain: area, role: snapshot, inScope, disabledModules });
}

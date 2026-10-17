import "server-only";
/**
 * The role filter choices of a sub-users directory toolbar, for every panel
 * (.vibe/memory/role-privilege-management.md, "Workspace RBAC pages"; same
 * rule as the platform's Sub-Platform Owners page).
 *
 * Domain-agnostic: the actor's own domain decides which privileges count
 * (`*.roles.view`, `*.users.create|edit` / `customer.sub_customers.create|edit`),
 * and every read goes through the role service, so scope and the ceiling are
 * enforced there.
 */
import type { RoleOptionView } from "@/components/rbac/types";
import type { AuthzActor } from "./actor";
import { holdsAnyPrivilege, holdsPrivilege } from "./management-common";
import { toRoleOptionView } from "./management-view";
import { listAssignableRoles, listRoles } from "./role-service";

// The filter reads the scope's roles page by page; the cap only guards against abuse.
const ROLE_FILTER_MAX_PAGES = 25;

/**
 * Description: Build the role filter choices of a sub-users directory.
 * Input: The panel's actor (built on the server).
 * Output: Every role of the actor's scope (active and disabled) when the actor
 *   may view roles; otherwise the roles the actor may assign (when allowed to
 *   create or edit sub-users); otherwise undefined (no role filter). A failed
 *   query also gives undefined (the toolbar then simply has no role filter).
 * Use case: /tenant/users and /customer/sub-customers toolbars (and any other
 *   panel's sub-users page).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function listRoleFilterOptions(actor: AuthzActor): Promise<RoleOptionView[] | undefined> {
  // Step 1: with the roles view privilege, every role of the scope, page by page.
  if (holdsPrivilege(actor, "rolesView")) {
    const options: RoleOptionView[] = [];
    for (let page = 1; page <= ROLE_FILTER_MAX_PAGES; page += 1) {
      const result = await listRoles(actor, { q: "", status: "all", page });
      if (!result.ok) return undefined;
      options.push(...result.data.rows.map(toRoleOptionView));
      if (page >= result.data.pageCount) break;
    }
    return options;
  }

  // Step 2: otherwise the assignable roles, when the actor may create or edit sub-users.
  if (holdsAnyPrivilege(actor, ["usersCreate", "usersEdit"])) {
    const result = await listAssignableRoles(actor);
    return result.ok ? result.data.map(toRoleOptionView) : undefined;
  }

  // Step 3: no role list is visible to this actor.
  return undefined;
}

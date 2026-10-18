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
import { holdsPrivilege } from "./management-common";
import { toRoleOptionView } from "./management-view";
import { searchRoleOptions } from "./role-service";
import { isUuid } from "@/lib/uuid";
import { toPolicyActor } from "./actor";
import { checkRoleAssignable, isMasterRole, roleCeilingKeys } from "./policy";
import { storeFor } from "./stores";

/**
 * Description: Read the first database page plus the currently selected role.
 * Input: The scoped actor and the optional selected role id from the URL.
 * Output: Initial role filter options, or undefined when not permitted/unavailable.
 * Use case: All three sub-user directories; later pages/search use searchRoleOptions.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-17
 */
export async function listRoleFilterOptions(actor: AuthzActor, selectedRoleId?: string): Promise<RoleOptionView[] | undefined> {
  const result = await searchRoleOptions(actor, { kind: "filter" });
  if (!result.ok) return undefined;
  const roles = result.data.rows.map(toRoleOptionView);
  if (isUuid(selectedRoleId) && !roles.some((role) => role.id === selectedRoleId)) {
    const selected = await storeFor(actor).findRole(selectedRoleId);
    const visible = selected && (holdsPrivilege(actor, "rolesView") || checkRoleAssignable(toPolicyActor(actor), selected).ok);
    if (selected && visible) {
      roles.push({ id: selected.id, name: selected.name, isMaster: isMasterRole(selected), privilegeCount: isMasterRole(selected) ? null : roleCeilingKeys(selected, actor.disabledModules).length });
    }
  }
  return roles;
}

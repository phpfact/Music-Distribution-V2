/**
 * Mapping of the role / sub-user management DTOs (management-model.ts, the
 * services' result types) to the serializable view types of the shared RBAC
 * screens (src/components/rbac/types.ts).
 *
 * Client-safe and pure: no database, no session, no `server-only` import.
 * Pages and Server Actions of every panel call these functions so the same
 * service answer always reaches the same component in the same shape
 * (.vibe/memory/role-privilege-management.md, "Platform role + Sub-Platform
 * Owner pages").
 */
import type { RbacStatusFilter } from "@/components/rbac/list-href";
import type {
  AssignedUserView,
  LockedPrivilegeView,
  ModuleView,
  PageView,
  RbacActionResult,
  ReadOnlyModuleView,
  RecordsResult,
  RoleFormState,
  RoleOptionView,
  RoleRowView,
  SubUserFormState,
  SubUserRowView,
  UserStatusValue,
} from "@/components/rbac/types";
import type { AssignedUserWithRoleView, PrivilegesResult } from "@/components/rbac/rbac-records";
import { NO_ACTIVE_ROLE_LABEL } from "@/components/shared/access-denied";
import { getModule, getPermission } from "./catalog";
import {
  parseSubUserListQuery,
  type AssignableRoleOption,
  type AssignedUserRow,
  type ManagementPage,
  type QueryResult,
  type RoleCountCategory,
  type RoleDetailsModule,
  type RoleEditorModule,
  type RoleListRow,
  type RoleMutationResult,
  type SubUserCountCategory,
  type SubUserListQuery,
  type SubUserMutationResult,
  type SubUserRow,
} from "./management-model";

/**
 * Description: Turn one service page into the components' page view.
 * Input: The service page and a function mapping one row.
 * Output: { rows, page, pageSize, total, pageCount } with the mapped rows.
 * Use case: Directories, assigned users and every count-details popup.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function toPageView<Row, View>(page: ManagementPage<Row>, mapRow: (row: Row) => View): PageView<View> {
  return {
    rows:      page.rows.map(mapRow),
    page:      page.page,
    pageSize:  page.pageSize,
    total:     page.total,
    pageCount: page.pageCount,
  };
}

/**
 * Description: Map an account status of the services to the components' status.
 * Input: "active" or "suspended" (as the services name it).
 * Output: "active" or "disabled" (as the components name it; shown as "Suspended").
 * Use case: Assigned users and sub-user rows.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function toUserStatus(status: "active" | "suspended"): UserStatusValue {
  return status === "active" ? "active" : "disabled";
}

/**
 * Description: Map one role list row to the roles directory row.
 * Input: The service row (RoleListRow).
 * Output: The RoleRowView (only what the directory displays; the privilege keys stay on the server).
 * Use case: Roles directory and the role count popups.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function toRoleRowView(row: RoleListRow): RoleRowView {
  return {
    id:             row.id,
    name:           row.name,
    description:    row.description,
    status:         row.status,
    isMaster:       row.isMaster,
    manageable:     row.manageable,
    privilegeCount: row.privilegeCount,
    userCount:      row.userCount,
    updatedAt:      row.updatedAt,
  };
}

/**
 * Description: Map one assigned user (role holder) to the components' user view.
 * Input: The service row (AssignedUserRow).
 * Output: The AssignedUserView (status "suspended" becomes "disabled").
 * Use case: Role details "Assigned users", users popups, disable/delete dialogs.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function toAssignedUserView(row: AssignedUserRow): AssignedUserView {
  return {
    id:       row.id,
    fullName: row.fullName,
    username: row.username,
    email:    row.email,
    status:   toUserStatus(row.status),
  };
}

/**
 * Description: Map one assigned user to the "Users assigned" popup row (with the role name).
 * Input: The service row (AssignedUserRow).
 * Output: The AssignedUserWithRoleView; a missing role reads "No active role".
 * Use case: "Users assigned" StatCard of the roles summary.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function toAssignedUserWithRoleView(row: AssignedUserRow): AssignedUserWithRoleView {
  return { ...toAssignedUserView(row), roleName: row.roleName ?? NO_ACTIVE_ROLE_LABEL };
}

/**
 * Description: Map one sub-user row to the sub-users directory row.
 * Input: The service row (SubUserRow).
 * Output: The SubUserRowView (status "suspended" becomes "disabled"; a missing
 *   role reads "No active role"; the account type only when present).
 * Use case: Sub-users directories and their count popups.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function toSubUserRowView(row: SubUserRow): SubUserRowView {
  return {
    id:           row.id,
    fullName:     row.fullName,
    username:     row.username,
    email:        row.email,
    roleName:     row.roleName ?? NO_ACTIVE_ROLE_LABEL,
    roleIsMaster: row.roleIsMaster,
    status:       toUserStatus(row.status),
    isPrimary:    row.isPrimary,
    isSelf:       row.isSelf,
    manageable:   row.manageable,
    // Only sub-customers have an account type; the key is left out otherwise.
    ...(row.accountType ? { accountType: row.accountType } : {}),
    createdAt:    row.createdAt,
  };
}

/**
 * Description: Map one assignable role (or any listed role) to a role picker option.
 * Input: A role with id, name, master flag and privilege count.
 * Output: The RoleOptionView.
 * Use case: Role picker, delete-and-reassign choices, the sub-users role filter.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function toRoleOptionView(role: Pick<AssignableRoleOption, "id" | "name" | "isMaster" | "privilegeCount">): RoleOptionView {
  return { id: role.id, name: role.name, isMaster: role.isMaster, privilegeCount: role.privilegeCount };
}

/**
 * Description: Map a role's privileges (grouped by module) to the read-only list view.
 * Input: The modules of RoleDetails (with the module-disabled flag).
 * Output: ReadOnlyModuleView[]; descriptions and `requires` come from the catalog
 *   (the single source of truth), every privilege of a switched-off module is
 *   marked `moduleDisabled`.
 * Use case: Role details "Privileges" section and the privileges popup.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function toReadOnlyModules(modules: readonly RoleDetailsModule[]): ReadOnlyModuleView[] {
  return modules.map((group) => ({
    key:         group.key,
    label:       group.label,
    description: getModule(group.key)?.description ?? "",
    privileges:  group.privileges.map((privilege) => ({
      key:            privilege.key,
      label:          privilege.label,
      description:    privilege.description,
      requires:       [...(getPermission(privilege.key)?.requires ?? [])],
      moduleDisabled: group.disabled,
    })),
  }));
}

/**
 * Description: Split the role editor model into checkboxes and the locked group.
 * Input: The modules of RoleEditorModel (each privilege assignable or locked with a reason).
 * Output: `modules` — only the privileges the actor MAY grant (modules without
 *   any are left out); `locked` — every other privilege with its module label
 *   and reason ("outside_privileges" / "module_disabled"), never a checkbox.
 * Use case: /<panel>/roles/new and /<panel>/roles/[id]/edit.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function toEditorModules(modules: readonly RoleEditorModule[]): { modules: ModuleView[]; locked: LockedPrivilegeView[] } {
  const assignable: ModuleView[]          = [];
  const locked: LockedPrivilegeView[]     = [];

  for (const group of modules) {
    // Step 1: the privileges this actor may tick become the module's checkboxes.
    const granted = group.privileges.filter((privilege) => privilege.assignable);
    if (granted.length > 0) {
      assignable.push({
        key:         group.key,
        label:       group.label,
        description: group.description,
        privileges:  granted.map((privilege) => ({
          key:         privilege.key,
          label:       privilege.label,
          description: privilege.description,
          requires:    [...privilege.requires],
        })),
      });
    }

    // Step 2: everything else is shown locked with its reason (a module that is
    // switched off counts as "module disabled" even without a stored reason).
    for (const privilege of group.privileges) {
      if (privilege.assignable) continue;
      locked.push({
        key:         privilege.key,
        label:       privilege.label,
        moduleLabel: group.label,
        reason:      privilege.lockedReason ?? (group.disabled ? "module_disabled" : "outside_privileges"),
      });
    }
  }
  return { modules: assignable, locked };
}

/**
 * Description: Map the roles summary popup filter to the service's count category.
 * Input: The popup filter ("all" | "active" | "disabled").
 * Output: "total" | "active" | "disabled".
 * Use case: Count-details loaders of the roles summary.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function roleCountCategory(filter: RbacStatusFilter): Exclude<RoleCountCategory, "users_assigned"> {
  return filter === "all" ? "total" : filter;
}

/**
 * Description: Map the sub-users summary popup filter to the service's count category.
 * Input: The popup filter ("all" | "active" | "disabled" = suspended).
 * Output: "total" | "active" | "suspended".
 * Use case: Count-details loaders of the sub-users summary.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function subUserCountCategory(filter: RbacStatusFilter): SubUserCountCategory {
  if (filter === "active") return "active";
  return filter === "disabled" ? "suspended" : "total";
}

/**
 * Description: Read the sub-users list query from the URL the shared toolbar writes.
 * Input: Next's searchParams (untrusted). The toolbar names the suspended
 *   filter "disabled" (shared with the roles directory).
 * Output: The service's SubUserListQuery (status "disabled" read as
 *   "suspended"; the role filter only when it is a UUID; page clamped).
 * Use case: Sub-users list pages of every panel.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function toSubUserListQuery(params: Record<string, string | string[] | undefined>): SubUserListQuery {
  const status = Array.isArray(params.status) ? params.status[0] : params.status;
  return parseSubUserListQuery({ ...params, status: status === "disabled" ? "suspended" : status });
}

/**
 * Description: Map a failed role mutation to the role editor's form state.
 * Input: The failed RoleMutationResult.
 * Output: { status: "error", fieldErrors, formMessage? }: name / description /
 *   status errors under their fields, the service's "permissions" error under
 *   the editor's "privileges" field; the message is form-level only when no
 *   field error explains it (forbidden, conflict without field, unavailable).
 * Use case: Role create / edit Server Actions of every panel.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function toRoleFormState(result: Extract<RoleMutationResult, { ok: false }>): RoleFormState {
  const source      = result.fieldErrors ?? {};
  const fieldErrors: Extract<RoleFormState, { status: "error" }>["fieldErrors"] = {};
  if (source.name) fieldErrors.name = source.name;
  if (source.description) fieldErrors.description = source.description;
  if (source.status) fieldErrors.status = source.status;
  if (source.permissions) fieldErrors.privileges = source.permissions;

  const hasFieldError = Object.keys(fieldErrors).length > 0;
  return hasFieldError ? { status: "error", fieldErrors } : { status: "error", fieldErrors, formMessage: result.error };
}

/**
 * Description: Map a failed sub-user mutation to the sub-user form's state.
 * Input: The failed SubUserMutationResult.
 * Output: { status: "error", fieldErrors, formMessage? }: errors under their
 *   fields (same field names); the message is form-level only when no field
 *   error explains it.
 * Use case: Sub-user create / edit Server Actions of every panel.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function toSubUserFormState(result: Extract<SubUserMutationResult, { ok: false }>): SubUserFormState {
  const fieldErrors   = { ...(result.fieldErrors ?? {}) };
  const hasFieldError = Object.keys(fieldErrors).length > 0;
  return hasFieldError ? { status: "error", fieldErrors } : { status: "error", fieldErrors, formMessage: result.error };
}

/**
 * Description: Map a paged service query to a count-details / records popup result.
 * Input: The service result (QueryResult of a page) and a function mapping one row.
 * Output: { ok: true, page } with the mapped rows, or { ok: false, error } with
 *   the service's friendly message.
 * Use case: Records loader Server Actions (users popups, summary figures) of every panel.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function toRecordsResult<Row, View>(
  result: QueryResult<ManagementPage<Row>>,
  mapRow: (row: Row) => View,
): RecordsResult<View> {
  return result.ok ? { ok: true, page: toPageView(result.data, mapRow) } : { ok: false, error: result.error };
}

/**
 * Description: Map the role details query to the privileges popup result.
 * Input: The getRoleDetails result (only its modules are used).
 * Output: { ok: true, modules } (read-only modules) or { ok: false, error }.
 * Use case: The privileges count of the roles directory / role details of every panel.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function toPrivilegesResult(result: QueryResult<{ modules: RoleDetailsModule[] }>): PrivilegesResult {
  return result.ok ? { ok: true, modules: toReadOnlyModules(result.data.modules) } : { ok: false, error: result.error };
}

/**
 * Description: Map a one-shot role or sub-user mutation to the components' action result.
 * Input: The mutation result (RoleMutationResult or SubUserMutationResult).
 * Output: { ok: true, message } or { ok: false, error }; a field error (e.g. the
 *   replacement role of a delete) is preferred because a dialog has no fields.
 * Use case: Disable/enable, delete and suspend/reactivate actions of every panel.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function toActionResult(result: RoleMutationResult | SubUserMutationResult): RbacActionResult {
  if (result.ok) return { ok: true, message: result.message };
  const fieldMessage = result.fieldErrors ? Object.values(result.fieldErrors).find((message) => Boolean(message)) : undefined;
  return { ok: false, error: fieldMessage ?? result.error };
}

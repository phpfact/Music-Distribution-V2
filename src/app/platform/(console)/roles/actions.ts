"use server";
/**
 * Server Actions of the Platform panel's Roles & Privileges pages
 * (.vibe/memory/role-privilege-management.md, "Technical Notes" → "RBAC
 * pages (all panels)").
 *
 * Each action is a public HTTP endpoint and stays one line: it hands its
 * EXACT privilege (authorizePlatformActor, refusal audited as authz.denied) and the
 * panel's paths to the shared handler in src/lib/authz/management-actions.ts,
 * which builds nothing from the browser, makes ONE role service call and maps
 * the answer. Ids, keys and statuses from the browser are only passed on as
 * untrusted values; the service validates, scopes (the control plane's platform roles) and enforces the
 * delegation ceiling.
 */
import type { RbacStatusFilter } from "@/components/rbac/list-href";
import type { AssignedUserWithRoleView, PrivilegesResult } from "@/components/rbac/rbac-records";
import type {
  AssignedUserView,
  RbacActionResult,
  RecordsResult,
  RoleFormState,
  RoleRowView,
  RoleStatusValue,
} from "@/components/rbac/types";
import {
  handleCreateRole,
  handleDeleteRole,
  handleLoadAssignedUserRecords,
  handleLoadRolePrivileges,
  handleLoadRoleRecords,
  handleLoadRoleUsers,
  handleSetRoleStatus,
  handleUpdateRole,
} from "@/lib/authz/management-actions";
import { authorizePlatformActor, PLATFORM_RBAC_PATHS } from "../rbac-actor";

/**
 * Description: Load one platform role's privileges grouped by module.
 * Input: The role id (untrusted).
 * Output: The read-only modules, or a friendly error (not found outside the actor's scope).
 * Use case: Privileges popup of the roles directory and role details (platform.roles.view).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function loadRolePrivilegesAction(roleId: string): Promise<PrivilegesResult> {
  return handleLoadRolePrivileges(() => authorizePlatformActor("platform.roles.view"), roleId);
}

/**
 * Description: Load one page of the users holding a platform role.
 * Input: The role id and the page (untrusted).
 * Output: The page of users (raw values; the UI masks them) or a friendly error.
 * Use case: Users popup, role details "Show all", disable/delete dialogs (platform.roles.view).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function loadRoleUsersAction(roleId: string, page: number): Promise<RecordsResult<AssignedUserView>> {
  return handleLoadRoleUsers(() => authorizePlatformActor("platform.roles.view"), roleId, page);
}

/**
 * Description: Load the roles behind a roles summary figure (Total / Active / Disabled).
 * Input: The figure's filter and the page (untrusted).
 * Output: One page of roles, or a friendly error.
 * Use case: RolesSummary popups on /platform/roles (platform.roles.view).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function loadRoleRecordsAction(filter: RbacStatusFilter, page: number): Promise<RecordsResult<RoleRowView>> {
  return handleLoadRoleRecords(() => authorizePlatformActor("platform.roles.view"), filter, page);
}

/**
 * Description: Load the users behind the "Users assigned" figure.
 * Input: The page (untrusted).
 * Output: One page of users with their role name, or a friendly error.
 * Use case: RolesSummary "Users assigned" popup on /platform/roles (platform.roles.view).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function loadAssignedUserRecordsAction(page: number): Promise<RecordsResult<AssignedUserWithRoleView>> {
  return handleLoadAssignedUserRecords(() => authorizePlatformActor("platform.roles.view"), page);
}

/**
 * Description: Create a platform role from the role editor.
 * Input: The previous form state (unused) and the FormData (name, description,
 *   status, privileges).
 * Output: Field errors / a friendly refusal, or a redirect to the new role's
 *   details page with the "role-created" notice.
 * Use case: /platform/roles/new (platform.roles.create).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function createRoleAction(_state: RoleFormState, formData: FormData): Promise<RoleFormState> {
  return handleCreateRole(() => authorizePlatformActor("platform.roles.create"), formData, PLATFORM_RBAC_PATHS);
}

/**
 * Description: Save a platform role from the role editor.
 * Input: The role id (bound on the server page; untrusted here), the previous
 *   state (unused) and the FormData.
 * Output: Field errors / a friendly refusal, or a redirect to the role's
 *   details page with the "role-saved" notice.
 * Use case: /platform/roles/[id]/edit (platform.roles.edit).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function updateRoleAction(roleId: string, _state: RoleFormState, formData: FormData): Promise<RoleFormState> {
  return handleUpdateRole(() => authorizePlatformActor("platform.roles.edit"), roleId, formData, PLATFORM_RBAC_PATHS);
}

/**
 * Description: Disable an active / enable a disabled platform role.
 * Input: The role id and the intended status ("disabled" for a role shown
 *   active, "active" for one shown disabled; computed by the shared row /
 *   details actions; both untrusted).
 * Output: The success message or a friendly error (already in that status —
 *   "refresh the page", own role, system role, above the ceiling, not found).
 * Use case: Disable/Enable confirmations of /platform/roles and /platform/roles/[id] (platform.roles.edit).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function setRoleStatusAction(roleId: string, status: RoleStatusValue): Promise<RbacActionResult> {
  return handleSetRoleStatus(() => authorizePlatformActor("platform.roles.edit"), roleId, status, PLATFORM_RBAC_PATHS);
}

/**
 * Description: Delete a platform role, moving its holders to the replacement role in one transaction.
 * Input: The role id and the replacement role id (null when nobody holds it; untrusted).
 * Output: The success message or a friendly error (replacement missing / not
 *   assignable, system role, above the ceiling, not found).
 * Use case: Delete confirmations of /platform/roles and /platform/roles/[id] (platform.roles.delete).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function deleteRoleAction(roleId: string, replacementRoleId: string | null): Promise<RbacActionResult> {
  return handleDeleteRole(() => authorizePlatformActor("platform.roles.delete"), roleId, replacementRoleId, PLATFORM_RBAC_PATHS);
}

"use server";
/**
 * Server Actions of the Tenant panel's Roles & Privileges pages
 * (.vibe/memory/role-privilege-management.md, "Technical Notes" → "RBAC
 * pages (all panels)").
 *
 * Each action is a public HTTP endpoint and stays one line: it hands its
 * EXACT privilege (authorizeTenantActor, refusal audited as authz.denied) and the
 * panel's paths to the shared handler in src/lib/authz/management-actions.ts,
 * which builds nothing from the browser, makes ONE role service call and maps
 * the answer. Ids, keys and statuses from the browser are only passed on as
 * untrusted values; the service validates, scopes (this tenant's database) and enforces the
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
import { authorizeTenantActor, TENANT_RBAC_PATHS } from "../rbac-actor";

/**
 * Description: Load one tenant role's privileges grouped by module.
 * Input: The role id (untrusted).
 * Output: The read-only modules, or a friendly error (not found outside the actor's scope).
 * Use case: Privileges popup of the roles directory and role details (tenant.roles.view).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function loadTenantRolePrivilegesAction(roleId: string): Promise<PrivilegesResult> {
  return handleLoadRolePrivileges(() => authorizeTenantActor("tenant.roles.view"), roleId);
}

/**
 * Description: Load one page of the users holding a tenant role.
 * Input: The role id and the page (untrusted).
 * Output: The page of users (raw values; the UI masks them) or a friendly error.
 * Use case: Users popup, role details "Show all", disable/delete dialogs (tenant.roles.view).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function loadTenantRoleUsersAction(roleId: string, page: number): Promise<RecordsResult<AssignedUserView>> {
  return handleLoadRoleUsers(() => authorizeTenantActor("tenant.roles.view"), roleId, page);
}

/**
 * Description: Load the roles behind a roles summary figure (Total / Active / Disabled).
 * Input: The figure's filter and the page (untrusted).
 * Output: One page of roles, or a friendly error.
 * Use case: RolesSummary popups on /tenant/roles (tenant.roles.view).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function loadTenantRoleRecordsAction(filter: RbacStatusFilter, page: number): Promise<RecordsResult<RoleRowView>> {
  return handleLoadRoleRecords(() => authorizeTenantActor("tenant.roles.view"), filter, page);
}

/**
 * Description: Load the users behind the "Users assigned" figure.
 * Input: The page (untrusted).
 * Output: One page of users with their role name, or a friendly error.
 * Use case: RolesSummary "Users assigned" popup on /tenant/roles (tenant.roles.view).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function loadTenantAssignedUserRecordsAction(page: number): Promise<RecordsResult<AssignedUserWithRoleView>> {
  return handleLoadAssignedUserRecords(() => authorizeTenantActor("tenant.roles.view"), page);
}

/**
 * Description: Create a tenant role from the role editor.
 * Input: The previous form state (unused) and the FormData (name, description,
 *   status, privileges).
 * Output: Field errors / a friendly refusal, or a redirect to the new role's
 *   details page with the "role-created" notice.
 * Use case: /tenant/roles/new (tenant.roles.create).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function createTenantRoleAction(_state: RoleFormState, formData: FormData): Promise<RoleFormState> {
  return handleCreateRole(() => authorizeTenantActor("tenant.roles.create"), formData, TENANT_RBAC_PATHS);
}

/**
 * Description: Save a tenant role from the role editor.
 * Input: The role id (bound on the server page; untrusted here), the previous
 *   state (unused) and the FormData.
 * Output: Field errors / a friendly refusal, or a redirect to the role's
 *   details page with the "role-saved" notice.
 * Use case: /tenant/roles/[id]/edit (tenant.roles.edit).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function updateTenantRoleAction(roleId: string, _state: RoleFormState, formData: FormData): Promise<RoleFormState> {
  return handleUpdateRole(() => authorizeTenantActor("tenant.roles.edit"), roleId, formData, TENANT_RBAC_PATHS);
}

/**
 * Description: Disable an active / enable a disabled tenant role.
 * Input: The role id and the intended status ("disabled" for a role shown
 *   active, "active" for one shown disabled; computed by the shared row /
 *   details actions; both untrusted).
 * Output: The success message or a friendly error (already in that status —
 *   "refresh the page", own role, system role, above the ceiling, not found).
 * Use case: Disable/Enable confirmations of /tenant/roles and /tenant/roles/[id] (tenant.roles.edit).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function setTenantRoleStatusAction(roleId: string, status: RoleStatusValue): Promise<RbacActionResult> {
  return handleSetRoleStatus(() => authorizeTenantActor("tenant.roles.edit"), roleId, status, TENANT_RBAC_PATHS);
}

/**
 * Description: Delete a tenant role, moving its holders to the replacement role in one transaction.
 * Input: The role id and the replacement role id (null when nobody holds it; untrusted).
 * Output: The success message or a friendly error (replacement missing / not
 *   assignable, system role, above the ceiling, not found).
 * Use case: Delete confirmations of /tenant/roles and /tenant/roles/[id] (tenant.roles.delete).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function deleteTenantRoleAction(roleId: string, replacementRoleId: string | null): Promise<RbacActionResult> {
  return handleDeleteRole(() => authorizeTenantActor("tenant.roles.delete"), roleId, replacementRoleId, TENANT_RBAC_PATHS);
}

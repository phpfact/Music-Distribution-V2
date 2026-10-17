"use server";
/**
 * Server Actions of the Customer panel's Roles & Privileges pages
 * (.vibe/memory/role-privilege-management.md, "Technical Notes" → "RBAC
 * pages (all panels)").
 *
 * Each action is a public HTTP endpoint and stays one line: it hands its
 * EXACT privilege (authorizeCustomerActor, refusal audited as authz.denied) and the
 * panel's paths to the shared handler in src/lib/authz/management-actions.ts,
 * which builds nothing from the browser, makes ONE role service call and maps
 * the answer. Ids, keys and statuses from the browser are only passed on as
 * untrusted values; the service validates, scopes (Master Customer + roles of the session user's main customer) and enforces the
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
import { authorizeCustomerActor, CUSTOMER_RBAC_PATHS } from "../rbac-actor";

/**
 * Description: Load one customer role's privileges grouped by module.
 * Input: The role id (untrusted).
 * Output: The read-only modules, or a friendly error (not found outside the actor's scope).
 * Use case: Privileges popup of the roles directory and role details (customer.roles.view).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function loadCustomerRolePrivilegesAction(roleId: string): Promise<PrivilegesResult> {
  return handleLoadRolePrivileges(() => authorizeCustomerActor("customer.roles.view"), roleId);
}

/**
 * Description: Load one page of the users holding a customer role.
 * Input: The role id and the page (untrusted).
 * Output: The page of users (raw values; the UI masks them) or a friendly error.
 * Use case: Users popup, role details "Show all", disable/delete dialogs (customer.roles.view).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function loadCustomerRoleUsersAction(roleId: string, page: number): Promise<RecordsResult<AssignedUserView>> {
  return handleLoadRoleUsers(() => authorizeCustomerActor("customer.roles.view"), roleId, page);
}

/**
 * Description: Load the roles behind a roles summary figure (Total / Active / Disabled).
 * Input: The figure's filter and the page (untrusted).
 * Output: One page of roles, or a friendly error.
 * Use case: RolesSummary popups on /customer/roles (customer.roles.view).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function loadCustomerRoleRecordsAction(filter: RbacStatusFilter, page: number): Promise<RecordsResult<RoleRowView>> {
  return handleLoadRoleRecords(() => authorizeCustomerActor("customer.roles.view"), filter, page);
}

/**
 * Description: Load the users behind the "Users assigned" figure.
 * Input: The page (untrusted).
 * Output: One page of users with their role name, or a friendly error.
 * Use case: RolesSummary "Users assigned" popup on /customer/roles (customer.roles.view).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function loadCustomerAssignedUserRecordsAction(page: number): Promise<RecordsResult<AssignedUserWithRoleView>> {
  return handleLoadAssignedUserRecords(() => authorizeCustomerActor("customer.roles.view"), page);
}

/**
 * Description: Create a customer role from the role editor.
 * Input: The previous form state (unused) and the FormData (name, description,
 *   status, privileges).
 * Output: Field errors / a friendly refusal, or a redirect to the new role's
 *   details page with the "role-created" notice.
 * Use case: /customer/roles/new (customer.roles.create).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function createCustomerRoleAction(_state: RoleFormState, formData: FormData): Promise<RoleFormState> {
  return handleCreateRole(() => authorizeCustomerActor("customer.roles.create"), formData, CUSTOMER_RBAC_PATHS);
}

/**
 * Description: Save a customer role from the role editor.
 * Input: The role id (bound on the server page; untrusted here), the previous
 *   state (unused) and the FormData.
 * Output: Field errors / a friendly refusal, or a redirect to the role's
 *   details page with the "role-saved" notice.
 * Use case: /customer/roles/[id]/edit (customer.roles.edit).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function updateCustomerRoleAction(roleId: string, _state: RoleFormState, formData: FormData): Promise<RoleFormState> {
  return handleUpdateRole(() => authorizeCustomerActor("customer.roles.edit"), roleId, formData, CUSTOMER_RBAC_PATHS);
}

/**
 * Description: Disable an active / enable a disabled customer role.
 * Input: The role id and the intended status ("disabled" for a role shown
 *   active, "active" for one shown disabled; computed by the shared row /
 *   details actions; both untrusted).
 * Output: The success message or a friendly error (already in that status —
 *   "refresh the page", own role, system role, above the ceiling, not found).
 * Use case: Disable/Enable confirmations of /customer/roles and /customer/roles/[id] (customer.roles.edit).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function setCustomerRoleStatusAction(roleId: string, status: RoleStatusValue): Promise<RbacActionResult> {
  return handleSetRoleStatus(() => authorizeCustomerActor("customer.roles.edit"), roleId, status, CUSTOMER_RBAC_PATHS);
}

/**
 * Description: Delete a customer role, moving its holders to the replacement role in one transaction.
 * Input: The role id and the replacement role id (null when nobody holds it; untrusted).
 * Output: The success message or a friendly error (replacement missing / not
 *   assignable, system role, above the ceiling, not found).
 * Use case: Delete confirmations of /customer/roles and /customer/roles/[id] (customer.roles.delete).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function deleteCustomerRoleAction(roleId: string, replacementRoleId: string | null): Promise<RbacActionResult> {
  return handleDeleteRole(() => authorizeCustomerActor("customer.roles.delete"), roleId, replacementRoleId, CUSTOMER_RBAC_PATHS);
}

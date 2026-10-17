"use server";
/**
 * Server Actions of the Tenant panel's Sub-Tenants pages
 * (.vibe/memory/role-privilege-management.md, "Technical Notes" → "RBAC
 * pages (all panels)").
 *
 * Each action is a public HTTP endpoint and stays one line: it hands its
 * EXACT privilege (authorizeTenantActor, refusal audited as authz.denied) and the
 * panel's paths to the shared handler in src/lib/authz/management-actions.ts.
 * Create / edit read exactly ONE role id there (parseSingleRoleId; zero,
 * several or a malformed id → error under Role, nothing written) before the
 * ONE sub-user service call, which re-validates the role's scope, the ceiling
 * and identity uniqueness (this tenant's database).
 */
import type { RbacStatusFilter } from "@/components/rbac/list-href";
import type { RbacActionResult, RecordsResult, SubUserFormState, SubUserRowView, UserStatusChange } from "@/components/rbac/types";
import {
  handleCreateSubUser,
  handleLoadSubUserRecords,
  handleSetSubUserStatus,
  handleUpdateSubUser,
} from "@/lib/authz/management-actions";
import { authorizeTenantActor, TENANT_RBAC_PATHS } from "../rbac-actor";

/**
 * Description: Load the Sub-Tenants behind a summary figure (Total / Active / Suspended).
 * Input: The figure's filter and the page (untrusted).
 * Output: One page of accounts, or a friendly error.
 * Use case: SubUsersSummary popups on /tenant/users (tenant.users.view).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function loadSubTenantRecordsAction(filter: RbacStatusFilter, page: number): Promise<RecordsResult<SubUserRowView>> {
  return handleLoadSubUserRecords(() => authorizeTenantActor("tenant.users.view"), filter, page);
}

/**
 * Description: Create a Sub-Tenant (staff user) with exactly one tenant role.
 * Input: The previous form state (unused) and the FormData (full name,
 *   username, email, password + confirmation, roleId).
 * Output: Field errors / a friendly refusal, or a redirect to /tenant/users
 *   with the "user-created" notice.
 * Use case: /tenant/users/new (tenant.users.create).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function createSubTenantAction(_state: SubUserFormState, formData: FormData): Promise<SubUserFormState> {
  return handleCreateSubUser(() => authorizeTenantActor("tenant.users.create"), formData, TENANT_RBAC_PATHS);
}

/**
 * Description: Save a Sub-Tenant: full name, the single role and an optional new password.
 * Input: The user id (bound on the server page; untrusted here), the previous
 *   state (unused) and the FormData.
 * Output: Field errors / a friendly refusal, or a redirect to /tenant/users
 *   with the "user-saved" notice.
 * Use case: /tenant/users/[id]/edit (tenant.users.edit).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function updateSubTenantAction(userId: string, _state: SubUserFormState, formData: FormData): Promise<SubUserFormState> {
  return handleUpdateSubUser(() => authorizeTenantActor("tenant.users.edit"), userId, formData, TENANT_RBAC_PATHS);
}

/**
 * Description: Suspend an active / reactivate a suspended Sub-Tenant.
 * Input: The user id and the change ("suspend" for an account shown active,
 *   "reactivate" for one shown suspended; computed by the shared row
 *   actions; both untrusted).
 * Output: The success message or a friendly error (already in that state —
 *   "refresh the page", own account, primary account, above the ceiling, not found).
 * Use case: Suspend/Reactivate confirmations of /tenant/users (tenant.users.suspend).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function setSubTenantStatusAction(userId: string, change: UserStatusChange): Promise<RbacActionResult> {
  return handleSetSubUserStatus(() => authorizeTenantActor("tenant.users.suspend"), userId, change, TENANT_RBAC_PATHS);
}

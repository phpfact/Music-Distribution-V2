"use server";
/**
 * Server Actions of the Platform panel's Sub-Platform Owners pages
 * (.vibe/memory/role-privilege-management.md, "Technical Notes" → "RBAC
 * pages (all panels)").
 *
 * Each action is a public HTTP endpoint and stays one line: it hands its
 * EXACT privilege (authorizePlatformActor, refusal audited as authz.denied) and the
 * panel's paths to the shared handler in src/lib/authz/management-actions.ts.
 * Create / edit read exactly ONE role id there (parseSingleRoleId; zero,
 * several or a malformed id → error under Role, nothing written) before the
 * ONE sub-user service call, which re-validates the role's scope, the ceiling
 * and identity uniqueness.
 */
import type { RbacStatusFilter } from "@/components/rbac/list-href";
import type { RbacActionResult, RecordsResult, SubUserFormState, SubUserRowView, UserStatusChange } from "@/components/rbac/types";
import {
  handleCreateSubUser,
  handleLoadSubUserRecords,
  handleSetSubUserStatus,
  handleUpdateSubUser,
} from "@/lib/authz/management-actions";
import { authorizePlatformActor, PLATFORM_RBAC_PATHS } from "../rbac-actor";

/**
 * Description: Load the Sub-Platform Owners behind a summary figure (Total / Active / Suspended).
 * Input: The figure's filter and the page (untrusted).
 * Output: One page of accounts, or a friendly error.
 * Use case: SubUsersSummary popups on /platform/users (platform.users.view).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function loadSubPlatformOwnerRecordsAction(filter: RbacStatusFilter, page: number): Promise<RecordsResult<SubUserRowView>> {
  return handleLoadSubUserRecords(() => authorizePlatformActor("platform.users.view"), filter, page);
}

/**
 * Description: Create a Sub-Platform Owner with exactly one platform role.
 * Input: The previous form state (unused) and the FormData (full name,
 *   username, password + confirmation, roleId).
 * Output: Field errors / a friendly refusal, or a redirect to /platform/users
 *   with the "user-created" notice.
 * Use case: /platform/users/new (platform.users.create).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function createSubPlatformOwnerAction(_state: SubUserFormState, formData: FormData): Promise<SubUserFormState> {
  return handleCreateSubUser(() => authorizePlatformActor("platform.users.create"), formData, PLATFORM_RBAC_PATHS);
}

/**
 * Description: Save a Sub-Platform Owner: full name, the single role and an optional new password.
 * Input: The user id (bound on the server page; untrusted here), the previous
 *   state (unused) and the FormData.
 * Output: Field errors / a friendly refusal, or a redirect to /platform/users
 *   with the "user-saved" notice.
 * Use case: /platform/users/[id]/edit (platform.users.edit).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function updateSubPlatformOwnerAction(userId: string, _state: SubUserFormState, formData: FormData): Promise<SubUserFormState> {
  return handleUpdateSubUser(() => authorizePlatformActor("platform.users.edit"), userId, formData, PLATFORM_RBAC_PATHS);
}

/**
 * Description: Suspend an active / reactivate a suspended Sub-Platform Owner.
 * Input: The user id and the change ("suspend" for an account shown active,
 *   "reactivate" for one shown suspended; computed by the shared row
 *   actions; both untrusted).
 * Output: The success message or a friendly error (already in that state —
 *   "refresh the page", own account, primary account, above the ceiling, not found).
 * Use case: Suspend/Reactivate confirmations of /platform/users (platform.users.suspend).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function setSubPlatformOwnerStatusAction(userId: string, change: UserStatusChange): Promise<RbacActionResult> {
  return handleSetSubUserStatus(() => authorizePlatformActor("platform.users.suspend"), userId, change, PLATFORM_RBAC_PATHS);
}

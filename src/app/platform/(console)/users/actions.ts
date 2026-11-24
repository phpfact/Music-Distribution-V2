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
  handleDeleteSubUser,
  handleLoadSubUserRecords,
  handleSetSubUserStatus,
  handleUpdateSubUser,
} from "@/lib/authz/management-actions";
import { storeFor } from "@/lib/authz/stores";
import { getRoleDetails } from "@/lib/authz/role-service";
import { updateSubUser } from "@/lib/authz/sub-user-service";
import { revalidatePath } from "next/cache";
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

/**
 * Description: Delete a Platform Owner safely (cannot delete self, primary super admin, or last admin).
 * Input: The user ID.
 * Output: Success message or a friendly error.
 * Use case: Row actions on /platform/users.
 * Author: Mr. Sachin Sharma
 * Created: 2026-11-24
 * Last modified: 2026-11-24
 */
export async function deleteSubPlatformOwnerAction(userId: string): Promise<RbacActionResult> {
  return handleDeleteSubUser(() => authorizePlatformActor("platform.users.delete"), userId, PLATFORM_RBAC_PATHS);
}

/**
 * Description: Quickly change the assigned role of a Platform Owner.
 * Input: Target user ID and the newly selected role ID.
 * Output: Success message or error.
 * Use case: Quick "Change Role" dialog on /platform/users.
 * Author: Mr. Sachin Sharma
 * Created: 2026-11-24
 * Last modified: 2026-11-24
 */
export async function changePlatformOwnerRoleAction(userId: string, roleId: string): Promise<RbacActionResult> {
  const authorization = await authorizePlatformActor("platform.users.edit");
  if (!authorization.ok) return { ok: false, error: authorization.error };

  const store = storeFor(authorization.actor);
  const target = await store.findUser(userId);
  if (!target) return { ok: false, error: "Platform owner not found." };

  const result = await updateSubUser(authorization.actor, userId, {
    fullName: target.fullName,
    roleId,
  });

  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(PLATFORM_RBAC_PATHS.users);
  revalidatePath(PLATFORM_RBAC_PATHS.roles);
  return { ok: true, message: "Role changed successfully." };
}

/**
 * Description: Administratively reset password of a Platform Owner.
 * Input: User ID, new password, and password confirmation.
 * Output: Success message or validation error.
 * Use case: "Reset Password" dialog on /platform/users.
 * Author: Mr. Sachin Sharma
 * Created: 2026-11-24
 * Last modified: 2026-11-24
 */
export async function resetPlatformOwnerPasswordAction(userId: string, formData: FormData): Promise<RbacActionResult> {
  const authorization = await authorizePlatformActor("platform.users.edit");
  if (!authorization.ok) return { ok: false, error: authorization.error };

  const store = storeFor(authorization.actor);
  const target = await store.findUser(userId);
  if (!target) return { ok: false, error: "Platform owner not found." };

  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const result = await updateSubUser(authorization.actor, userId, {
    fullName: target.fullName,
    roleId: target.role?.id ?? "",
    password,
    confirmPassword,
  });

  if (!result.ok) {
    const errorMsg = result.fieldErrors?.password || result.fieldErrors?.confirmPassword || result.error;
    return { ok: false, error: errorMsg };
  }

  revalidatePath(PLATFORM_RBAC_PATHS.users);
  return { ok: true, message: "Password reset successfully. All active sessions revoked." };
}

/**
 * Description: Load full details of a Platform Owner including permissions granted by their role.
 * Input: User ID.
 * Output: Platform owner details and role permissions.
 * Use case: "View Details" dialog or page on /platform/users.
 * Author: Mr. Sachin Sharma
 * Created: 2026-11-24
 * Last modified: 2026-11-24
 */
export async function loadPlatformOwnerDetailsAction(userId: string): Promise<{
  ok: boolean;
  data?: {
    id: string;
    fullName: string;
    username: string;
    email: string | null;
    phone: string | null;
    status: string;
    isPrimary: boolean;
    createdAt: string;
    lastLoginAt: string | null;
    role: {
      id: string;
      name: string;
      isMaster: boolean;
      status: string;
      permissions: { key: string; label: string; description: string }[];
    } | null;
  };
  error?: string;
}> {
  const authorization = await authorizePlatformActor("platform.users.view");
  if (!authorization.ok) return { ok: false, error: authorization.error };

  const store = storeFor(authorization.actor);
  const user = await store.findUser(userId);
  if (!user) return { ok: false, error: "Platform owner not found." };

  let roleDetails = null;
  if (user.role?.id) {
    const roleRes = await getRoleDetails(authorization.actor, user.role.id);
    if (roleRes.ok) {
      roleDetails = {
        id: roleRes.data.role.id,
        name: roleRes.data.role.name,
        isMaster: roleRes.data.role.isMaster,
        status: roleRes.data.role.status,
        permissions: roleRes.data.modules.flatMap((m) => m.privileges),
      };
    }
  }

  return {
    ok: true,
    data: {
      id: user.id,
      fullName: user.fullName,
      username: user.username ?? "",
      email: user.email,
      phone: user.phone ?? null,
      status: user.status,
      isPrimary: user.isPrimary,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      role: roleDetails,
    },
  };
}

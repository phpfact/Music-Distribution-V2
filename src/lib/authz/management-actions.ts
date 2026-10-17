import "server-only";
/**
 * The bodies of the role and sub-user Server Actions of ALL three panels
 * (Platform, Tenant, Customer; .vibe/memory/role-privilege-management.md,
 * "Technical Notes" → "RBAC pages (all panels)").
 *
 * Every panel's `"use server"` file only declares its public actions; each
 * action is one line that hands its exact authorize step (a callback built
 * from the panel's `rbac-actor.ts`, e.g. `() => authorizeTenantActor(
 * "tenant.roles.create")`) and the panel's paths to ONE handler below. So the
 * pattern is identical everywhere:
 * 1. authorize the exact privilege and build the actor (refusal: friendly
 *    error + `authz.denied`, written by the panel's authorize call),
 * 2. read the submitted values (untrusted; sub-users: exactly one role id via
 *    parseSingleRoleId, error under Role, before anything is written),
 * 3. make ONE service call (it re-validates, scopes, enforces the delegation
 *    ceiling inside its transaction and audits),
 * 4. refresh the affected pages and map the answer to the components' state
 *    (create/edit redirect with a fixed `?notice=` code).
 *
 * Server-only: never imported by client code.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { RbacStatusFilter } from "@/components/rbac/list-href";
import type { AssignedUserWithRoleView, PrivilegesResult } from "@/components/rbac/rbac-records";
import { withRbacNotice } from "@/components/rbac/screens/notices";
import type {
  AssignedUserView,
  RbacActionResult,
  RecordsResult,
  RoleFormState,
  RoleRowView,
  SubUserFormState,
  SubUserRowView,
} from "@/components/rbac/types";
import { describeError } from "@/lib/platform-auth/session";
import {
  roleCountCategory,
  subUserCountCategory,
  toActionResult,
  toAssignedUserView,
  toAssignedUserWithRoleView,
  toPageView,
  toPrivilegesResult,
  toRecordsResult,
  toRoleFormState,
  toRoleRowView,
  toSubUserFormState,
  toSubUserRowView,
} from "./management-view";
import type { AuthorizedActor } from "./page-support";
import { parseSingleRoleId } from "./policy";
import {
  createRole,
  deleteRole,
  getRoleDetails,
  listRoleCountRecords,
  listRoleUsers,
  setRoleStatus,
  updateRole,
  type RoleInput,
} from "./role-service";
import { createSubUser, listSubUserCountRecords, setSubUserStatus, updateSubUser } from "./sub-user-service";

/** The panel's authorize step for one action (exact privilege → actor or friendly refusal). */
export type AuthorizeStep = () => Promise<AuthorizedActor>;

/** The list paths of one panel (details/new/edit pages derive from them). */
export type RbacPanelPaths = {
  /** The roles list, e.g. "/tenant/roles". */
  roles: string;
  /** The sub-users list, e.g. "/tenant/users" or "/customer/sub-customers". */
  users: string;
};

// ---------------------------------------------------------------------------
// Shared steps

/**
 * Description: The form state of a refused (unauthorized) form submission.
 * Input: The friendly refusal message from the panel's authorize step.
 * Output: An error state with only the form-level message (no field errors).
 * Use case: Role and sub-user form actions without their privilege.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function refusedFormState(error: string): RoleFormState & SubUserFormState {
  return { status: "error", fieldErrors: {}, formMessage: error };
}

/**
 * Description: Refresh the rendered pages a committed change affects.
 * Input: The page paths to revalidate.
 * Output: None. A refresh failure is only logged: the change is already committed.
 * Use case: Every successful role / sub-user mutation of every panel.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function refreshPages(paths: readonly string[]): void {
  try {
    for (const path of paths) revalidatePath(path);
  } catch (error) {
    console.error(`[rbac] could not refresh ${paths.join(", ")}: ${describeError(error)}`);
  }
}

/**
 * Description: Read the role editor's submission.
 * Input: The FormData (`name`, `description`, `status`, one `privileges` entry per key).
 * Output: The untrusted RoleInput; every value is validated by the service
 *   (unknown, foreign and above-ceiling keys are refused there).
 * Use case: handleCreateRole / handleUpdateRole.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function roleInputOf(formData: FormData): RoleInput {
  return {
    name:        formData.get("name"),
    description: formData.get("description"),
    status:      formData.get("status"),
    permissions: formData.getAll("privileges"),
  };
}

// ---------------------------------------------------------------------------
// Roles

/**
 * Description: Load one role's privileges grouped by module (privileges popup).
 * Input: The panel's `*.roles.view` authorize step and the role id (untrusted).
 * Output: The read-only modules (module-disabled ones marked), or a friendly
 *   error (an id outside the actor's scope is "not found").
 * Use case: The privileges count of the roles directory and role details.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function handleLoadRolePrivileges(authorize: AuthorizeStep, roleId: unknown): Promise<PrivilegesResult> {
  const authorization = await authorize();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  return toPrivilegesResult(await getRoleDetails(authorization.actor, roleId));
}

/**
 * Description: Load one page of the users holding a role.
 * Input: The panel's `*.roles.view` authorize step, the role id and the page (untrusted).
 * Output: The page of users (raw values; the UI masks them) or a friendly error.
 * Use case: Users popup, role details "Show all", disable/delete confirmations.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function handleLoadRoleUsers(
  authorize: AuthorizeStep,
  roleId: unknown,
  page: unknown,
): Promise<RecordsResult<AssignedUserView>> {
  const authorization = await authorize();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  return toRecordsResult(await listRoleUsers(authorization.actor, roleId, page), toAssignedUserView);
}

/**
 * Description: Load the roles behind a roles summary figure (Total / Active / Disabled).
 * Input: The panel's `*.roles.view` authorize step, the figure's filter and the
 *   page (untrusted; an unexpected filter maps to an unknown category, which
 *   the service refuses).
 * Output: One page of roles, or a friendly error.
 * Use case: RolesSummary popups of every roles list.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function handleLoadRoleRecords(
  authorize: AuthorizeStep,
  filter: RbacStatusFilter,
  page: unknown,
): Promise<RecordsResult<RoleRowView>> {
  const authorization = await authorize();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const result = await listRoleCountRecords(authorization.actor, roleCountCategory(filter), page);
  if (!result.ok) return { ok: false, error: result.error };
  // Only a roles figure answers with roles ("users_assigned" has its own loader).
  if (result.data.kind !== "roles") return { ok: false, error: "Choose a valid group of roles." };
  return { ok: true, page: toPageView(result.data.page, toRoleRowView) };
}

/**
 * Description: Load the users behind the "Users assigned" figure.
 * Input: The panel's `*.roles.view` authorize step and the page (untrusted).
 * Output: One page of users with their role name, or a friendly error.
 * Use case: RolesSummary "Users assigned" popup of every roles list.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function handleLoadAssignedUserRecords(
  authorize: AuthorizeStep,
  page: unknown,
): Promise<RecordsResult<AssignedUserWithRoleView>> {
  const authorization = await authorize();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const result = await listRoleCountRecords(authorization.actor, "users_assigned", page);
  if (!result.ok) return { ok: false, error: result.error };
  if (result.data.kind !== "users") return { ok: false, error: "Choose a valid group of users." };
  return { ok: true, page: toPageView(result.data.page, toAssignedUserWithRoleView) };
}

/**
 * Description: Create a role from the role editor.
 * Input: The panel's `*.roles.create` authorize step, the FormData (name,
 *   description, status, privileges) and the panel's paths.
 * Output: Field errors (e.g. a privilege above the ceiling under Privileges,
 *   audited as authz.escalation_blocked by the service) / a friendly refusal,
 *   or a redirect to the new role's details page with "role-created".
 * Use case: /<panel>/roles/new "Save role".
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function handleCreateRole(authorize: AuthorizeStep, formData: FormData, paths: RbacPanelPaths): Promise<RoleFormState> {
  // Step 1: privilege and actor.
  const authorization = await authorize();
  if (!authorization.ok) return refusedFormState(authorization.error);

  // Step 2: one service call (validation, ceiling, uniqueness, audit).
  const result = await createRole(authorization.actor, roleInputOf(formData));
  if (!result.ok) return toRoleFormState(result);

  // Step 3: fresh pages, then the new role with a notice (redirect throws; outside any try).
  const detailsPath = `${paths.roles}/${result.roleId}`;
  refreshPages([paths.roles, detailsPath]);
  redirect(withRbacNotice(detailsPath, "role-created"));
}

/**
 * Description: Save an edited role from the role editor.
 * Input: The panel's `*.roles.edit` authorize step, the role id (bound by the
 *   page; untrusted here), the FormData and the panel's paths.
 * Output: Field errors / a friendly refusal (not found, system role, own
 *   role, above the ceiling), or a redirect to the role's details page with
 *   "role-saved".
 * Use case: /<panel>/roles/[id]/edit "Save role".
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function handleUpdateRole(
  authorize: AuthorizeStep,
  roleId: unknown,
  formData: FormData,
  paths: RbacPanelPaths,
): Promise<RoleFormState> {
  // Step 1: privilege and actor.
  const authorization = await authorize();
  if (!authorization.ok) return refusedFormState(authorization.error);

  // Step 2: one service call (re-checks scope and ceiling inside its transaction).
  const result = await updateRole(authorization.actor, roleId, roleInputOf(formData));
  if (!result.ok) return toRoleFormState(result);

  // Step 3: back to the details page with a notice.
  const detailsPath = `${paths.roles}/${result.roleId}`;
  refreshPages([paths.roles, detailsPath]);
  redirect(withRbacNotice(detailsPath, "role-saved"));
}

/**
 * Description: Disable or enable a role.
 * Input: The panel's `*.roles.edit` authorize step, the role id and the
 *   intended status ("disabled" | "active", computed by the shared row actions
 *   / details actions from the status they show; both untrusted) and the paths.
 * Output: The success message, or a friendly error. The service refuses a
 *   change to the status the role already has ("Refresh the page"), so a stale
 *   page never flips a role back; also own role, system role, above the
 *   ceiling, not found.
 * Use case: Disable/Enable confirmations of the roles directory and role details.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function handleSetRoleStatus(
  authorize: AuthorizeStep,
  roleId: unknown,
  status: unknown,
  paths: RbacPanelPaths,
): Promise<RbacActionResult> {
  const authorization = await authorize();
  if (!authorization.ok) return { ok: false, error: authorization.error };

  const result = await setRoleStatus(authorization.actor, roleId, status);
  if (result.ok) refreshPages([paths.roles, `${paths.roles}/${result.roleId}`]);
  return toActionResult(result);
}

/**
 * Description: Delete a role, moving its holders to the replacement role in one transaction.
 * Input: The panel's `*.roles.delete` authorize step, the role id, the
 *   replacement role id (null / undefined = none given; untrusted — the
 *   service accepts exactly one id when users hold the role) and the paths.
 * Output: The success message, or a friendly error (replacement missing / not
 *   assignable, system role, above the ceiling, not found).
 * Use case: Delete confirmations of the roles directory and role details.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function handleDeleteRole(
  authorize: AuthorizeStep,
  roleId: unknown,
  replacementRoleId: unknown,
  paths: RbacPanelPaths,
): Promise<RbacActionResult> {
  const authorization = await authorize();
  if (!authorization.ok) return { ok: false, error: authorization.error };

  // null / undefined mean "no replacement given"; anything else goes to the service as is.
  const replacement = replacementRoleId === null || replacementRoleId === undefined ? undefined : replacementRoleId;
  const result      = await deleteRole(authorization.actor, roleId, { replacementRoleId: replacement });
  // Holder counts change on both lists when users were reassigned.
  if (result.ok) refreshPages([paths.roles, paths.users]);
  return toActionResult(result);
}

// ---------------------------------------------------------------------------
// Sub-users (Sub-Platform Owners, Sub-Tenants, Sub-Customers)

/**
 * Description: Load the accounts behind a sub-users summary figure (Total / Active / Suspended).
 * Input: The panel's users view authorize step, the figure's filter and the page (untrusted).
 * Output: One page of accounts, or a friendly error.
 * Use case: SubUsersSummary popups of every sub-users list.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function handleLoadSubUserRecords(
  authorize: AuthorizeStep,
  filter: RbacStatusFilter,
  page: unknown,
): Promise<RecordsResult<SubUserRowView>> {
  const authorization = await authorize();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const result = await listSubUserCountRecords(authorization.actor, subUserCountCategory(filter), page);
  return result.ok ? { ok: true, page: toPageView(result.data.page, toSubUserRowView) } : { ok: false, error: result.error };
}

/**
 * Description: Create a sub-user with exactly one role.
 * Input: The panel's users create authorize step, the FormData of SubUserForm
 *   (create: full name, account type for sub-customers, username, email for
 *   tenant/customer, password + confirmation, roleId) and the paths.
 * Output: Field errors / a friendly refusal, or a redirect to the sub-users
 *   list with "user-created". Zero, several or a malformed role id → error
 *   under Role and nothing is written (the service re-validates anyway).
 *   Fields a variant does not have arrive as null and are ignored.
 * Use case: /platform/users/new, /tenant/users/new, /customer/sub-customers/new.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function handleCreateSubUser(authorize: AuthorizeStep, formData: FormData, paths: RbacPanelPaths): Promise<SubUserFormState> {
  // Step 1: privilege and actor.
  const authorization = await authorize();
  if (!authorization.ok) return refusedFormState(authorization.error);

  // Step 2: exactly one role id (arrays, repeats and malformed ids are refused here).
  const role = parseSingleRoleId(formData.getAll("roleId"));
  if (!role.ok) return { status: "error", fieldErrors: { roleId: role.error } };

  // Step 3: one service call (rules, role scope + ceiling, identities, audit).
  const result = await createSubUser(authorization.actor, {
    fullName:        formData.get("fullName"),
    accountType:     formData.get("accountType"),
    username:        formData.get("username"),
    email:           formData.get("email"),
    password:        formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    roleId:          role.roleId,
  });
  if (!result.ok) return toSubUserFormState(result);

  // Step 4: fresh lists (holder counts change on the roles pages too), then the list with a notice.
  refreshPages([paths.users, paths.roles]);
  redirect(withRbacNotice(paths.users, "user-created"));
}

/**
 * Description: Save a sub-user: full name, the single role and an optional new password.
 * Input: The panel's users edit authorize step, the user id (bound by the
 *   page; untrusted here), the FormData and the paths. Only full name, every
 *   `roleId` entry and the password pair are read, so a crafted email,
 *   username or account type never reaches the service.
 * Output: Field errors / a friendly refusal (own account, primary account,
 *   above the ceiling, not found), or a redirect to the list with "user-saved".
 *   Zero, several or a malformed role id → error under Role, nothing written.
 * Use case: /platform/users/[id]/edit, /tenant/users/[id]/edit, /customer/sub-customers/[id]/edit.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function handleUpdateSubUser(
  authorize: AuthorizeStep,
  userId: unknown,
  formData: FormData,
  paths: RbacPanelPaths,
): Promise<SubUserFormState> {
  // Step 1: privilege and actor.
  const authorization = await authorize();
  if (!authorization.ok) return refusedFormState(authorization.error);

  // Step 2: exactly one role id.
  const role = parseSingleRoleId(formData.getAll("roleId"));
  if (!role.ok) return { status: "error", fieldErrors: { roleId: role.error } };

  // Step 3: one service call (missing password pair = empty = keep the password).
  const result = await updateSubUser(authorization.actor, userId, {
    fullName:        formData.get("fullName"),
    roleId:          role.roleId,
    password:        formData.get("password") ?? "",
    confirmPassword: formData.get("confirmPassword") ?? "",
  });
  if (!result.ok) return toSubUserFormState(result);

  // Step 4: fresh lists, then the list with a notice.
  refreshPages([paths.users, paths.roles]);
  redirect(withRbacNotice(paths.users, "user-saved"));
}

/**
 * Description: Suspend or reactivate a sub-user.
 * Input: The panel's users suspend authorize step, the user id and the change
 *   ("suspend" | "reactivate", computed by the shared row actions from the
 *   status they show; both untrusted) and the paths.
 * Output: The success message, or a friendly error. The service refuses a
 *   change to the state the account already has ("Refresh the page"); also
 *   own account, primary account, above the ceiling, not found.
 * Use case: Suspend/Reactivate confirmations of every sub-users directory.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function handleSetSubUserStatus(
  authorize: AuthorizeStep,
  userId: unknown,
  change: unknown,
  paths: RbacPanelPaths,
): Promise<RbacActionResult> {
  const authorization = await authorize();
  if (!authorization.ok) return { ok: false, error: authorization.error };

  const result = await setSubUserStatus(authorization.actor, userId, change);
  if (result.ok) refreshPages([paths.users]);
  return toActionResult(result);
}

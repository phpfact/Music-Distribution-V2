"use server";
/**
 * Server Actions of the Customer panel's Sub-Customers pages
 * (.vibe/memory/role-privilege-management.md, "Technical Notes" → "RBAC
 * pages (all panels)").
 *
 * Each action is a public HTTP endpoint and stays one line: it hands its
 * EXACT privilege (authorizeCustomerActor, refusal audited as authz.denied) and the
 * panel's paths to the shared handler in src/lib/authz/management-actions.ts.
 * Create / edit read exactly ONE role id there (parseSingleRoleId; zero,
 * several or a malformed id → error under Role, nothing written) before the
 * ONE sub-user service call, which re-validates the role's scope, the ceiling
 * and identity uniqueness (sub-customers of the session user's main customer only).
 */
import type { RbacStatusFilter } from "@/components/rbac/list-href";
import type { RbacActionResult, RecordsResult, SubUserFormState, SubUserRowView, UserStatusChange } from "@/components/rbac/types";
import {
  handleCreateSubUser,
  handleLoadSubUserRecords,
  handleSetSubUserStatus,
  handleUpdateSubUser,
} from "@/lib/authz/management-actions";
import { authorizeCustomerActor, CUSTOMER_RBAC_PATHS } from "../rbac-actor";

/**
 * Description: Load the Sub-Customers behind a summary figure (Total / Active / Suspended).
 * Input: The figure's filter and the page (untrusted).
 * Output: One page of accounts, or a friendly error.
 * Use case: SubUsersSummary popups on /customer/sub-customers (customer.sub_customers.view).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function loadSubCustomerRecordsAction(filter: RbacStatusFilter, page: number): Promise<RecordsResult<SubUserRowView>> {
  return handleLoadSubUserRecords(() => authorizeCustomerActor("customer.sub_customers.view"), filter, page);
}

/**
 * Description: Create a Sub-Customer (a customer row whose parent is the session
 *   user's MAIN customer, its login user and exactly one customer role).
 * Input: The previous form state (unused) and the FormData (full name, account
 *   type, username, email, password + confirmation, roleId).
 * Output: Field errors / a friendly refusal, or a redirect to /customer/sub-customers
 *   with the "user-created" notice.
 * Use case: /customer/sub-customers/new (customer.sub_customers.create).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function createSubCustomerAction(_state: SubUserFormState, formData: FormData): Promise<SubUserFormState> {
  return handleCreateSubUser(() => authorizeCustomerActor("customer.sub_customers.create"), formData, CUSTOMER_RBAC_PATHS);
}

/**
 * Description: Save a Sub-Customer: full name, the single role and an optional new password.
 * Input: The user id (bound on the server page; untrusted here), the previous
 *   state (unused) and the FormData.
 * Output: Field errors / a friendly refusal, or a redirect to /customer/sub-customers
 *   with the "user-saved" notice.
 * Use case: /customer/sub-customers/[id]/edit (customer.sub_customers.edit).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function updateSubCustomerAction(userId: string, _state: SubUserFormState, formData: FormData): Promise<SubUserFormState> {
  return handleUpdateSubUser(() => authorizeCustomerActor("customer.sub_customers.edit"), userId, formData, CUSTOMER_RBAC_PATHS);
}

/**
 * Description: Suspend an active / reactivate a suspended Sub-Customer.
 * Input: The user id and the change ("suspend" for an account shown active,
 *   "reactivate" for one shown suspended; computed by the shared row
 *   actions; both untrusted).
 * Output: The success message or a friendly error (already in that state —
 *   "refresh the page", own account, primary account, above the ceiling, not found).
 * Use case: Suspend/Reactivate confirmations of /customer/sub-customers (customer.sub_customers.suspend).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function setSubCustomerStatusAction(userId: string, change: UserStatusChange): Promise<RbacActionResult> {
  return handleSetSubUserStatus(() => authorizeCustomerActor("customer.sub_customers.suspend"), userId, change, CUSTOMER_RBAC_PATHS);
}

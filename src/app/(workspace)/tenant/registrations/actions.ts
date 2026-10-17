"use server";

import { headers } from "next/headers";
import { clientIpFromForwardedFor } from "@/lib/platform-auth/rate-limit";
import { describeError } from "@/lib/platform-auth/session";
import type { TenantPermissionKey } from "@/lib/authz/catalog";
import { authorizeTenantAction } from "@/lib/authz/workspace";
import type { TenantArea } from "@/lib/workspace/guards";
import {
  approveRegistration,
  listRegistrations,
  rejectRegistration,
  setCustomerAccountStatus,
  type RegistrationActor,
  type ReviewOutcome,
} from "@/lib/workspace/registrations";
import {
  parseRegistrationFilter,
  parseRegistrationPage,
  textOf,
  type RegistrationActionResult,
  type RegistrationRecordsResult,
} from "@/lib/workspace/rules";

/**
 * Description: Authorize one registrations action by its tenant privilege.
 * Input: The privilege the action needs (tenant.registrations.view / review / suspend).
 * Output: { ok: true, area } or { ok: false, error } with the friendly message;
 *   a refusal is audited as authz.denied (with the client address). A visitor
 *   without a tenant session is redirected to /login.
 * Use case: Every action in this file (the page is not the protection;
 *   .vibe/memory/role-privilege-management.md).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
async function authorize(
  permission: TenantPermissionKey,
): Promise<{ ok: true; area: TenantArea } | { ok: false; error: string }> {
  return authorizeTenantAction(permission, { ipAddress: await clientIp() });
}

/**
 * Description: Describe the signed-in staff user as the reviewer.
 * Input: The tenant area.
 * Output: The reviewer recorded on the registration and in the audit log.
 * Use case: Review actions.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function ownerActor(area: TenantArea): RegistrationActor {
  return { type: "tenant_user", id: area.user.id };
}

/**
 * Description: Turn a service outcome into the action's answer.
 * Input: The outcome and the success message.
 * Output: { ok, message } or { ok: false, error }.
 * Use case: Review actions.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function answer(outcome: ReviewOutcome, message: string): RegistrationActionResult {
  return outcome.ok ? { ok: true, message } : { ok: false, error: outcome.message };
}

/**
 * Description: Read the client address for the audit log.
 * Input: None (request headers).
 * Output: The normalized client IP.
 * Use case: Review actions.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
async function clientIp(): Promise<string> {
  return clientIpFromForwardedFor((await headers()).get("x-forwarded-for"));
}

/**
 * Description: Load the registrations behind a summary figure (one page).
 * Input: The filter and the page (untrusted).
 * Output: The page of registrations, or a friendly error.
 * Use case: Count-details popups on the tenant dashboard and registrations page
 *   (needs tenant.registrations.view).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function loadTenantRegistrationRecordsAction(
  filter: unknown,
  page: unknown,
): Promise<RegistrationRecordsResult> {
  const authorization = await authorize("tenant.registrations.view");
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const { area } = authorization;
  const status = parseRegistrationFilter(filter);
  if (!status) return { ok: false, error: "Choose a valid group of registrations." };

  try {
    return { ok: true, page: await listRegistrations(area.db, { q: "", status, page: parseRegistrationPage(page) }) };
  } catch (error) {
    console.error(`[registrations] tenant ${area.tenant.id}: records could not be loaded: ${describeError(error)}`);
    return { ok: false, error: "The registrations could not be loaded right now. Try again." };
  }
}

/**
 * Description: Approve a pending registration of this tenant.
 * Input: The registration id (untrusted).
 * Output: Success message or a friendly error.
 * Use case: Approve on /tenant/registrations (needs tenant.registrations.review).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function approveTenantRegistrationAction(registrationId: unknown): Promise<RegistrationActionResult> {
  const authorization = await authorize("tenant.registrations.review");
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const { area } = authorization;
  const outcome = await approveRegistration(area.db, area.tenant.id, textOf(registrationId), ownerActor(area), await clientIp());
  return answer(outcome, "The registration was approved. The customer can log in now.");
}

/**
 * Description: Reject a pending registration of this tenant with a reason.
 * Input: The registration id and the reason (untrusted).
 * Output: Success message or a friendly error.
 * Use case: Reject on /tenant/registrations (needs tenant.registrations.review).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function rejectTenantRegistrationAction(
  registrationId: unknown,
  reason: unknown,
): Promise<RegistrationActionResult> {
  const authorization = await authorize("tenant.registrations.review");
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const { area } = authorization;
  const outcome = await rejectRegistration(area.db, area.tenant.id, textOf(registrationId), reason, ownerActor(area), await clientIp());
  return answer(outcome, "The registration was rejected. The applicant will see your reason.");
}

/**
 * Description: Suspend the customer account of an approved registration of this tenant.
 * Input: The registration id (untrusted).
 * Output: Success message or a friendly error.
 * Use case: Suspend on /tenant/registrations (needs tenant.registrations.suspend).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function suspendTenantCustomerAction(registrationId: unknown): Promise<RegistrationActionResult> {
  const authorization = await authorize("tenant.registrations.suspend");
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const { area } = authorization;
  const outcome = await setCustomerAccountStatus(area.db, area.tenant.id, textOf(registrationId), "suspend", ownerActor(area), await clientIp());
  return answer(outcome, "The account was suspended and signed out.");
}

/**
 * Description: Reactivate the suspended customer account of a registration of this tenant.
 * Input: The registration id (untrusted).
 * Output: Success message or a friendly error.
 * Use case: Reactivate on /tenant/registrations (needs tenant.registrations.suspend).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function reactivateTenantCustomerAction(registrationId: unknown): Promise<RegistrationActionResult> {
  const authorization = await authorize("tenant.registrations.suspend");
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const { area } = authorization;
  const outcome = await setCustomerAccountStatus(area.db, area.tenant.id, textOf(registrationId), "reactivate", ownerActor(area), await clientIp());
  return answer(outcome, "The account was reactivated. The customer can log in again.");
}

"use server";

import { headers } from "next/headers";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { clientIpFromForwardedFor } from "@/lib/platform-auth/rate-limit";
import { describeError } from "@/lib/platform-auth/session";
import { openTenantForPlatformOwner } from "@/lib/workspace/platform-access";
import {
  approveRegistration,
  listRegistrations,
  rejectRegistration,
  setCustomerAccountStatus,
  type ReviewOutcome,
} from "@/lib/workspace/registrations";
import {
  parseRegistrationFilter,
  parseRegistrationPage,
  textOf,
  type RegistrationActionResult,
  type RegistrationRecordsResult,
} from "@/lib/workspace/rules";

const TENANT_UNAVAILABLE = "This tenant's registrations are not available right now.";

/**
 * Description: Turn a service outcome into the action's answer.
 * Input: The outcome and the success message.
 * Output: { ok, message } or { ok: false, error }.
 * Use case: Review actions of this file.
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
 * Use case: Review actions of this file.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
async function clientIp(): Promise<string> {
  return clientIpFromForwardedFor((await headers()).get("x-forwarded-for"));
}

/**
 * Description: Load the registrations behind a summary figure (one page) for a Platform Owner.
 * Input: The tenant id (bound by the page), the filter and the page (untrusted).
 * Output: The page of registrations, or a friendly error.
 * Use case: Count-details popups on /platform/tenants/<id>/registrations.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function loadPlatformRegistrationRecordsAction(
  tenantId: unknown,
  filter: unknown,
  page: unknown,
): Promise<RegistrationRecordsResult> {
  await requirePlatformOwner();
  const status = parseRegistrationFilter(filter);
  if (!status) return { ok: false, error: "Choose a valid group of registrations." };
  const access = await openTenantForPlatformOwner(textOf(tenantId));
  if (!access.ok) return { ok: false, error: TENANT_UNAVAILABLE };

  try {
    return { ok: true, page: await listRegistrations(access.db, { q: "", status, page: parseRegistrationPage(page) }) };
  } catch (error) {
    console.error(`[registrations] platform could not load records: ${describeError(error)}`);
    return { ok: false, error: "The registrations could not be loaded right now. Try again." };
  }
}

/**
 * Description: Approve a pending registration of a tenant as a Platform Owner.
 * Input: The tenant id (bound by the page) and the registration id (untrusted).
 * Output: Success message or a friendly error.
 * Use case: Approve on /platform/tenants/<id>/registrations.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function approvePlatformRegistrationAction(
  tenantId: unknown,
  registrationId: unknown,
): Promise<RegistrationActionResult> {
  const session = await requirePlatformOwner();
  const access  = await openTenantForPlatformOwner(textOf(tenantId));
  if (!access.ok) return { ok: false, error: TENANT_UNAVAILABLE };
  const outcome = await approveRegistration(
    access.db,
    access.tenant.id,
    textOf(registrationId),
    { type: "platform_owner", id: session.owner.id },
    await clientIp(),
  );
  return answer(outcome, "The registration was approved. The customer can log in now.");
}

/**
 * Description: Reject a pending registration of a tenant as a Platform Owner.
 * Input: The tenant id (bound by the page), the registration id and the reason (untrusted).
 * Output: Success message or a friendly error.
 * Use case: Reject on /platform/tenants/<id>/registrations.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function rejectPlatformRegistrationAction(
  tenantId: unknown,
  registrationId: unknown,
  reason: unknown,
): Promise<RegistrationActionResult> {
  const session = await requirePlatformOwner();
  const access  = await openTenantForPlatformOwner(textOf(tenantId));
  if (!access.ok) return { ok: false, error: TENANT_UNAVAILABLE };
  const outcome = await rejectRegistration(
    access.db,
    access.tenant.id,
    textOf(registrationId),
    reason,
    { type: "platform_owner", id: session.owner.id },
    await clientIp(),
  );
  return answer(outcome, "The registration was rejected. The applicant will see your reason.");
}

/**
 * Description: Suspend the customer account of an approved registration as a Platform Owner.
 * Input: The tenant id (bound by the page) and the registration id (untrusted).
 * Output: Success message or a friendly error.
 * Use case: Suspend on /platform/tenants/<id>/registrations.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function suspendPlatformCustomerAction(
  tenantId: unknown,
  registrationId: unknown,
): Promise<RegistrationActionResult> {
  const session = await requirePlatformOwner();
  const access  = await openTenantForPlatformOwner(textOf(tenantId));
  if (!access.ok) return { ok: false, error: TENANT_UNAVAILABLE };
  const outcome = await setCustomerAccountStatus(
    access.db,
    access.tenant.id,
    textOf(registrationId),
    "suspend",
    { type: "platform_owner", id: session.owner.id },
    await clientIp(),
  );
  return answer(outcome, "The account was suspended and signed out.");
}

/**
 * Description: Reactivate a suspended customer account as a Platform Owner.
 * Input: The tenant id (bound by the page) and the registration id (untrusted).
 * Output: Success message or a friendly error.
 * Use case: Reactivate on /platform/tenants/<id>/registrations.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function reactivatePlatformCustomerAction(
  tenantId: unknown,
  registrationId: unknown,
): Promise<RegistrationActionResult> {
  const session = await requirePlatformOwner();
  const access  = await openTenantForPlatformOwner(textOf(tenantId));
  if (!access.ok) return { ok: false, error: TENANT_UNAVAILABLE };
  const outcome = await setCustomerAccountStatus(
    access.db,
    access.tenant.id,
    textOf(registrationId),
    "reactivate",
    { type: "platform_owner", id: session.owner.id },
    await clientIp(),
  );
  return answer(outcome, "The account was reactivated. The customer can log in again.");
}

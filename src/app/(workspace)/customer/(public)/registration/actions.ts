"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIpFromForwardedFor } from "@/lib/platform-auth/rate-limit";
import { describeError } from "@/lib/platform-auth/session";
import { getWorkspace } from "@/lib/workspace/context";
import { WORKSPACE_COOKIES, workspaceCookieOptions } from "@/lib/workspace/cookies";
import { LOGIN_PATH, REGISTRATION_STATUS_PATH, requireApplicant } from "@/lib/workspace/guards";
import { requestRegistrationReview } from "@/lib/workspace/registrations";
import { revokeRegistrationSession } from "@/lib/workspace/sessions";

export type ReviewRequestState = {
  status: "idle" | "error" | "success";
  /** Shown under the message field (too long). */
  fieldError?: string;
  /** A red alert above the form. */
  formError?: string;
};

const FORM_ERRORS = {
  not_rejected: "A review has already been requested for this registration. Please wait for the decision.",
  rate_limited: "You have sent several review requests today. Please try again tomorrow.",
  unavailable: "Your request could not be sent. Please try again shortly.",
} as const;

/**
 * Description: Ask the tenant to review a rejected registration again.
 * Input: The previous state (unused) and the FormData (optional message).
 * Output: "success" (the page re-renders showing the pending review), a field
 *   error, or a form error. The registration comes from the verified
 *   registration session, never from the form.
 * Use case: The "Request review" form on /customer/registration.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function requestReviewAction(
  _previousState: ReviewRequestState,
  formData: FormData,
): Promise<ReviewRequestState> {
  // Step 1: only the applicant's own limited session may ask (redirects otherwise).
  const area = await requireApplicant();

  // Step 2: the service validates the message, rate-limits and changes the status.
  const clientIp = clientIpFromForwardedFor((await headers()).get("x-forwarded-for"));
  const result   = await requestRegistrationReview(
    area.db,
    area.tenant.id,
    area.applicant.registrationId,
    formData instanceof FormData ? formData.get("message") : null,
    clientIp,
  );

  if (!result.ok) {
    if (result.reason === "validation") return { status: "error", fieldError: result.error };
    return { status: "error", formError: FORM_ERRORS[result.reason] };
  }

  // Step 3: re-render the page with the new status.
  revalidatePath(REGISTRATION_STATUS_PATH);
  return { status: "success" };
}

/**
 * Description: End the applicant's limited session.
 * Input: None (reads the registration cookie).
 * Output: The session row is deleted, the cookie removed (same name and path)
 *   and the browser sent to /login. Never returns.
 * Use case: "Sign out" on /customer/registration.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function applicantLogoutAction(): Promise<void> {
  const cookieStore = await cookies();
  const cookie      = WORKSPACE_COOKIES.registration;
  const token       = cookieStore.get(cookie.name)?.value;

  // Step 1: revoke the session in this tenant's database (best effort).
  const workspace = await getWorkspace();
  if (token && workspace.state === "ready") {
    try {
      await revokeRegistrationSession(workspace.db, workspace.tenant.id, token);
    } catch (error) {
      console.error(`[workspace-auth] could not revoke an applicant session: ${describeError(error)}`);
    }
  }

  // Step 2: delete the cookie with the same name and path it was set with.
  const { httpOnly, secure, sameSite, path } = workspaceCookieOptions("registration");
  cookieStore.delete({ name: cookie.name, httpOnly, secure, sameSite, path });

  // Throws by design, so it stays outside any try/catch.
  redirect(LOGIN_PATH);
}

"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIpFromForwardedFor } from "@/lib/platform-auth/rate-limit";
import { WORKSPACE_COOKIES, workspaceCookieOptions } from "@/lib/workspace/cookies";
import {
  CUSTOMER_HOME_PATH,
  REGISTRATION_STATUS_PATH,
  requireReadyWorkspace,
  TENANT_HOME_PATH,
} from "@/lib/workspace/guards";
import { authenticateWorkspaceUser } from "@/lib/workspace/login";
import { LOGIN_IDENTIFIER_MAX_LENGTH, textOf, type LoginFieldErrors } from "@/lib/workspace/rules";

/** What the login form is re-rendered with after a failed attempt. Never the password. */
export type WorkspaceLoginState = {
  /** A red alert above the form (wrong credentials, suspended, rate limited …). */
  formError?: string;
  /** A neutral notice (registration still waiting for approval). */
  formNotice?: string;
  fieldErrors?: LoginFieldErrors;
  /** The submitted identifier, so the field keeps its value. */
  identifier: string;
};

const FORM_ERRORS = {
  invalid_credentials: "Invalid username/email or password.",
  suspended: "This account is suspended. Please contact the workspace administrator.",
  rate_limited: "Too many sign-in attempts. Please try again in a few minutes.",
  unavailable: "Sign-in is temporarily unavailable. Please try again shortly.",
} as const;

// Where each kind of session lands after signing in.
const DESTINATIONS = {
  tenant: TENANT_HOME_PATH,
  customer: CUSTOMER_HOME_PATH,
  registration: REGISTRATION_STATUS_PATH,
} as const;

/**
 * Description: Sign a tenant staff user, a customer or a rejected applicant in.
 * Input: The previous form state (unused) and the submitted FormData
 *   (identifier, password; untrusted).
 * Output: On success the area's session cookie and a redirect to that area
 *   (never returns); otherwise the form state with field errors, an error or a
 *   notice, and the submitted identifier (never the password).
 * Use case: The shared login form at /login. The tenant comes from the Host
 *   header only; the destination is decided by the account, never by the form.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function workspaceLoginAction(
  _previousState: WorkspaceLoginState,
  formData: FormData,
): Promise<WorkspaceLoginState> {
  // Step 1: the tenant of this host (unknown → 404, suspended → notice page).
  const workspace = await requireReadyWorkspace();

  // Step 2: the submitted values (anything that is not text counts as empty).
  const identifierInput = formData instanceof FormData ? formData.get("identifier") : null;
  const passwordInput   = formData instanceof FormData ? formData.get("password") : null;
  const identifier      = textOf(identifierInput).slice(0, LOGIN_IDENTIFIER_MAX_LENGTH);

  // Step 3: the whole decision happens in the service.
  const clientIp = clientIpFromForwardedFor((await headers()).get("x-forwarded-for"));
  const result   = await authenticateWorkspaceUser(workspace, { identifier: identifierInput, password: passwordInput }, clientIp);

  if (!result.ok) {
    if (result.reason === "validation") return { fieldErrors: result.fieldErrors, identifier };
    if (result.reason === "pending") {
      return {
        formNotice: `Your registration is waiting for approval by ${workspace.tenant.name}. You can log in as soon as it has been approved.`,
        identifier,
      };
    }
    return { formError: FORM_ERRORS[result.reason], identifier };
  }

  // Step 4: the area's own cookie (host-only, path-scoped) and its landing page.
  const cookieStore = await cookies();
  const cookie      = WORKSPACE_COOKIES[result.destination];
  cookieStore.set(cookie.name, result.token, workspaceCookieOptions(result.destination));

  // Throws by design, so it stays outside any try/catch.
  redirect(DESTINATIONS[result.destination]);
}

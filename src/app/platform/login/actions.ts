"use server";

import { currentRequestContext } from "@/lib/request-context-server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticatePlatformOwner, type LoginFieldErrors } from "@/lib/platform-auth/login";
import { clientIpFromForwardedFor } from "@/lib/platform-auth/rate-limit";
import {
  describeError,
  revokeSession,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/lib/platform-auth/session";
import { USERNAME_MAX_LENGTH } from "@/lib/platform-auth/username";

/** What the login form is re-rendered with after a failed attempt. Never the password. */
export type LoginFormState = {
  formError?: string;
  fieldErrors?: LoginFieldErrors;
  /** The submitted user name, so the field keeps its value. */
  username: string;
};

const FORM_ERRORS = {
  invalid_credentials: "Invalid username or password.",
  rate_limited: "Too many sign-in attempts. Try again later.",
  unavailable: "Sign-in is temporarily unavailable. Try again shortly.",
} as const;

/**
 * Description: Sign a platform owner in.
 * Input: The previous form state (unused) and the submitted FormData
 *   (username, password; untrusted).
 * Output: On success a session cookie and a redirect to the dashboard (never
 *   returns); otherwise the form state with field errors or a form error and
 *   the submitted username (never the password).
 * Use case: The sign-in form. A Server Action is a public HTTP endpoint, so
 *   nothing here relies on the form: every check is made on the server, in
 *   authenticatePlatformOwner. The destination is fixed; no return URL is read.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-17
 */
export async function loginAction(
  _previousState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  /**
   * Description: Read one submitted field without trusting its type.
   * Input: The field name.
   * Output: The raw value, or null when the argument is not FormData.
   * Use case: loginAction.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  const field = (name: string): unknown =>
    formData instanceof FormData ? formData.get(name) : null;
  const submittedUsername = field("username");
  const username =
    typeof submittedUsername === "string" ? submittedUsername.slice(0, USERNAME_MAX_LENGTH) : "";

  const clientIp = clientIpFromForwardedFor((await headers()).get("x-forwarded-for"));
  const result = await authenticatePlatformOwner(
    { username: submittedUsername, password: field("password") },
    clientIp,
    await currentRequestContext(),
  );

  if (!result.ok) {
    if (result.reason === "validation") {
      return { fieldErrors: result.fieldErrors, username };
    }
    return { formError: FORM_ERRORS[result.reason], username };
  }

  const cookieStore = await cookies();
  // A session this browser already had is ended rather than left behind.
  const previousToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (previousToken) {
    try {
      await revokeSession(previousToken);
    } catch (error) {
      // It still expires on its own; the new sign-in is not held up by it.
      console.error(
        `[platform-auth] could not revoke the previous session: ${describeError(error)}`,
      );
    }
  }
  cookieStore.set(SESSION_COOKIE_NAME, result.token, sessionCookieOptions());

  // Throws by design, so it stays outside any try/catch.
  redirect("/platform/dashboard");
}

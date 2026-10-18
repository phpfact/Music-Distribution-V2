"use server";

import { recordAuthenticationEvent } from "@/lib/security-events";
import { currentRequestContext } from "@/lib/request-context-server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadPlatformAccess } from "@/lib/authz/platform-access";
import { getControlDb } from "@/lib/db/control";
import {
  describeError,
  revokeSession,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  validateSession,
} from "@/lib/platform-auth/session";

/**
 * Description: Sign the platform owner out.
 * Input: None (reads the session cookie).
 * Output: The session row is deleted, the cookie is removed (which also
 *   clears the Next.js router cache) and the browser is redirected to the login
 *   page, also when there was no session. Never returns.
 * Use case: "Sign out" in the account menu (with and without JavaScript).
 *   Together with AuthPageGuard, Back after sign-out never shows a protected page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-17
 */
export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  const token       = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    const context = await currentRequestContext();
    let actorId: string | null = null;
    // Attribution cannot prevent revocation when a session lookup is unavailable.
    try {
      actorId = (await validateSession(token, { touch: false }))?.owner.id ?? null;
    } catch (error) {
      console.error(`[platform-auth] logout attribution unavailable: ${describeError(error)}`);
    }
    let outcome: "success" | "unavailable" = "success";
    try {
      await revokeSession(token);
    } catch (error) {
      outcome = "unavailable";
      // The cookie is removed regardless; the session row expires on its own.
      console.error(`[platform-auth] could not revoke the session: ${describeError(error)}`);
    }
    recordAuthenticationEvent({ operation: "logout", area: "platform", tenantId: null, actorId,
      outcome, reason: outcome === "success" ? "logged_out" : "unavailable",
      clientIp: context?.clientIp ?? null, requestContext: context });
  }

  // Same name and path as when it was set, or the browser would keep it.
  const { httpOnly, secure, sameSite, path } = sessionCookieOptions();
  cookieStore.delete({ name: SESSION_COOKIE_NAME, httpOnly, secure, sameSite, path });

  // Throws by design, so it stays outside any try/catch.
  redirect("/platform/login");
}

/**
 * Description: Report whether this browser is still signed in and the hash of
 *   the owner's CURRENT platform privileges.
 * Input: None (reads the session cookie).
 * Output: { signedIn: false, fingerprint: null } without a valid session,
 *   otherwise { signedIn: true, fingerprint } — never anything else (no ids,
 *   no privilege keys). The session is validated with touch: false, so this
 *   background poll never extends the idle timeout. A database error is logged
 *   and answered with a generic error (the browser ignores it silently).
 * Use case: PermissionSync in the console layout (every 30 s, on focus, on
 *   route change): a changed fingerprint refreshes the navigation and page
 *   (.vibe/memory/role-privilege-management.md).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function platformFingerprintAction(): Promise<{ signedIn: boolean; fingerprint: string | null }> {
  try {
    // Step 1: the session, without counting this poll as activity.
    const token   = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    const session = token ? await validateSession(token, { touch: false }) : null;
    if (!session) return { signedIn: false, fingerprint: null };

    // Step 2: the same fresh decision every page makes.
    const access = await loadPlatformAccess(getControlDb(), session.owner.id);
    return { signedIn: true, fingerprint: access.fingerprint };
  } catch (error) {
    console.error(`[authz] could not read the platform privilege fingerprint: ${describeError(error)}`);
    throw new Error("The privilege check is unavailable right now.");
  }
}

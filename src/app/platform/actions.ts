"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  describeError,
  revokeSession,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
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
 * Last modified: 2026-10-15
 */
export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  const token       = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    try {
      await revokeSession(token);
      console.log("[platform-auth] logout succeeded");
    } catch (error) {
      // The cookie is removed regardless; the session row expires on its own.
      console.error(`[platform-auth] could not revoke the session: ${describeError(error)}`);
    }
  }

  // Same name and path as when it was set, or the browser would keep it.
  const { httpOnly, secure, sameSite, path } = sessionCookieOptions();
  cookieStore.delete({ name: SESSION_COOKIE_NAME, httpOnly, secure, sameSite, path });

  // Throws by design, so it stays outside any try/catch.
  redirect("/platform/login");
}

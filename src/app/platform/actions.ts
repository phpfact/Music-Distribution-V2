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
 * Signs the platform owner out: ends the session on the server and removes
 * the cookie. Always ends at the login page, also when there was no session.
 */
export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    try {
      await revokeSession(token);
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

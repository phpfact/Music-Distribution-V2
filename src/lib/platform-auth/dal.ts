import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, validateSession, type PlatformSession } from "./session";

/**
 * Description: Read the platform owner session of the current request.
 * Input: None (reads the session cookie of the request).
 * Output: The session (id and owner id/username), or null when signed out,
 *   expired, idle or disabled. This is the authoritative check: it asks the
 *   database every time, memoized only for the duration of one render pass.
 * Use case: Layouts and pages that behave differently for signed-in owners.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export const getPlatformSession = cache(async (): Promise<PlatformSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return validateSession(token);
});

/**
 * Description: Require a signed-in platform owner.
 * Input: None (reads the session cookie of the request).
 * Output: The session; anyone else is redirected to /platform/login (never returns).
 * Use case: Every protected console page and every Server Action.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function requirePlatformOwner(): Promise<PlatformSession> {
  const session = await getPlatformSession();
  if (!session) redirect("/platform/login");
  return session;
}

import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, validateSession, type PlatformSession } from "./session";

/**
 * The platform owner session of the current request, or null. This is the
 * authoritative check: it asks the database every time, memoized only for the
 * duration of one render pass.
 */
export const getPlatformSession = cache(async (): Promise<PlatformSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return validateSession(token);
});

/** For pages only a signed-in platform owner may see: anyone else goes to the login page. */
export async function requirePlatformOwner(): Promise<PlatformSession> {
  const session = await getPlatformSession();
  if (!session) redirect("/platform/login");
  return session;
}

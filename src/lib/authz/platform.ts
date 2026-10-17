import "server-only";
/**
 * Request guards of the Platform Panel: session + effective privileges
 * (.vibe/memory/role-privilege-management.md, "Technical Notes").
 *
 * Every protected page and Server Action checks the privilege itself (hidden
 * navigation is only a convenience). The privileges are loaded fresh for each
 * request and memoized for that request only (React `cache()`), never across
 * requests.
 *
 * requirePlatformOwner() (src/lib/platform-auth/dal.ts) keeps working as the
 * session-only guard until every caller has moved to these functions.
 */
import { cache } from "react";
import { redirect } from "next/navigation";
import { getControlDb } from "@/lib/db/control";
import { getPlatformSession } from "@/lib/platform-auth/dal";
import type { PlatformSession } from "@/lib/platform-auth/session";
import type { PlatformPermissionKey } from "./catalog";
import { recordAuthzDenial } from "./denials";
import { loadPlatformAccess, type PlatformAccess } from "./platform-access";
import { forbiddenMessage } from "./resolver";

/** Where a request without a valid platform session is sent. */
export const PLATFORM_LOGIN_PATH = "/platform/login";

/** The verified session and the effective privileges of its owner. */
export type PlatformAccessContext = { session: PlatformSession; access: PlatformAccess };

/** The outcome of authorizing one platform action. */
export type PlatformAuthorization =
  | ({ ok: true } & PlatformAccessContext)
  | { ok: false; error: string };

/**
 * Description: Read the session and effective platform privileges of this request.
 * Input: None (reads the platform session cookie).
 * Output: The session and access, or null when signed out / expired / idle /
 *   disabled. Asks the database on every request; memoized for one request only.
 * Use case: Layouts and pages that adapt to the owner's privileges.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export const getPlatformAccess = cache(async (): Promise<PlatformAccessContext | null> => {
  // Step 1: the authoritative session check (status active, not expired/idle).
  const session = await getPlatformSession();
  if (!session) return null;
  // Step 2: the owner's role, privileges and module switches, read fresh.
  const access = await loadPlatformAccess(getControlDb(), session.owner.id);
  return { session, access };
});

/**
 * Description: Require a signed-in platform owner and return their privileges.
 * Input: None (reads the platform session cookie).
 * Output: The session and access; anyone without a valid session is redirected
 *   to /platform/login (never returns). A missing/disabled role still returns
 *   (empty privileges), so the page can show its access-denied state.
 * Use case: Every protected console page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function requirePlatformAccess(): Promise<PlatformAccessContext> {
  const context = await getPlatformAccess();
  if (!context) redirect(PLATFORM_LOGIN_PATH);
  return context;
}

/**
 * Description: Authorize one platform Server Action by privilege.
 * Input: The privilege the action needs and, optionally, the client address for
 *   the audit row.
 * Output: `{ ok: true, session, access }`, or `{ ok: false, error }` with a
 *   friendly message (never internal details); a refusal writes an
 *   `authz.denied` audit row. Without a valid session it redirects to the
 *   login page (never returns).
 * Use case: Every platform Server Action, before it changes anything.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function authorizePlatformAction(
  permission: PlatformPermissionKey,
  options: { ipAddress?: string | null } = {},
): Promise<PlatformAuthorization> {
  // Step 1: session and fresh privileges (redirects when signed out).
  const context = await requirePlatformAccess();

  // Step 2: deny by default.
  if (context.access.can(permission)) return { ok: true, ...context };

  // Step 3: refused — audited, with a message that reveals nothing internal.
  await recordAuthzDenial({
    actorType: "super_admin",
    actorId: context.session.owner.id,
    tenantId: null,
    permission,
    roleState: context.access.roleState,
    ipAddress: options.ipAddress,
  });
  return { ok: false, error: forbiddenMessage(context.access) };
}

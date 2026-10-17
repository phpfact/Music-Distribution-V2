"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authorizeTenantAction, requireTenantAccess } from "@/lib/authz/workspace";
import { clientIpFromForwardedFor } from "@/lib/platform-auth/rate-limit";
import { describeError } from "@/lib/platform-auth/session";
import { saveViewerAppearance } from "@/lib/workspace/appearance";
import { parseWorkspaceAppearanceUpdate, type WorkspaceAppearanceActionResult } from "@/lib/workspace/appearance-options";
import { getWorkspace } from "@/lib/workspace/context";
import { WORKSPACE_COOKIES, workspaceCookieOptions } from "@/lib/workspace/cookies";
import { LOGIN_PATH, readAreaFingerprint, type AreaFingerprint } from "@/lib/workspace/guards";
import { revokeUserSession } from "@/lib/workspace/sessions";
import { TENANT_BASE_PATH } from "./navigation";

/**
 * Description: Sign the tenant staff user out.
 * Input: None (reads the tenant area cookie).
 * Output: The session row is deleted in the tenant's database, the cookie is
 *   removed with the same name and path (which also clears the router cache)
 *   and the browser goes to /login — also when there was no session. Never returns.
 * Use case: "Log out" in the tenant area's account menu (with and without JavaScript).
 *   With AuthPageGuard, Back after logging out never shows a protected page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function tenantLogoutAction(): Promise<void> {
  const cookieStore = await cookies();
  const cookie      = WORKSPACE_COOKIES.tenant;
  const token       = cookieStore.get(cookie.name)?.value;

  // Step 1: revoke the session (best effort: the cookie goes either way).
  const workspace = await getWorkspace();
  if (token && workspace.state === "ready") {
    try {
      await revokeUserSession(workspace.db, workspace.tenant.id, "tenant", token);
      console.log(`[workspace-auth] tenant ${workspace.tenant.id}: tenant logout succeeded`);
    } catch (error) {
      console.error(`[workspace-auth] could not revoke a tenant session: ${describeError(error)}`);
    }
  }

  // Step 2: delete the cookie with the same name and path it was set with.
  const { httpOnly, secure, sameSite, path } = workspaceCookieOptions("tenant");
  cookieStore.delete({ name: cookie.name, httpOnly, secure, sameSite, path });

  // Throws by design, so it stays outside any try/catch.
  redirect(LOGIN_PATH);
}

/**
 * Description: Save or reset the tenant staff user's appearance (or, with the
 *   tenant.appearance.manage_workspace privilege, the workspace default).
 * Input: The untrusted save request ({ operation, scope, appearance? }).
 * Output: The new appearance state or a friendly error. The user and their
 *   privileges come from the verified session, never from the request. A
 *   workspace-scope request without the privilege is refused (and audited as
 *   authz.denied) before anything is saved; the server re-renders /tenant (no
 *   full reload) after a committed save.
 * Use case: The tenant Appearance page and the header's theme switch.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function saveTenantAppearanceAction(input: unknown): Promise<WorkspaceAppearanceActionResult> {
  // Step 1: a signed-in tenant staff user of this host (redirects otherwise).
  const clientIp = clientIpFromForwardedFor((await headers()).get("x-forwarded-for"));
  const area     = await requireTenantAccess();

  // Step 2: the workspace default needs its privilege (refusal audited here;
  // personal appearance stays available to everyone).
  if (parseWorkspaceAppearanceUpdate(input)?.scope === "workspace") {
    const authorization = await authorizeTenantAction("tenant.appearance.manage_workspace", { ipAddress: clientIp });
    if (!authorization.ok) return { ok: false, error: authorization.error };
  }

  // Step 3: validate and save (the service re-checks the privilege flag).
  const result = await saveViewerAppearance(
    area.db,
    {
      userId: area.user.id,
      tenantId: area.tenant.id,
      canManageWorkspace: area.authz.can("tenant.appearance.manage_workspace"),
    },
    input,
    clientIp,
  );

  // Step 4: re-render the tenant area with the new theme.
  if (result.ok) revalidatePath(TENANT_BASE_PATH, "layout");
  return result;
}

/**
 * Description: Report whether the tenant staff session is still valid and the
 *   hash of the user's current privileges.
 * Input: None (Host header and the tenant area cookie).
 * Output: { signedIn, fingerprint } and nothing else. The session is validated
 *   with touch: false (a background poll never extends the idle timeout).
 *   A server error is logged and answered with a generic error, which the
 *   browser ignores silently.
 * Use case: PermissionSync in the tenant layout
 *   (.vibe/memory/role-privilege-management.md).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function tenantFingerprintAction(): Promise<AreaFingerprint> {
  try {
    return await readAreaFingerprint("tenant");
  } catch (error) {
    console.error(`[authz] could not read the tenant privilege fingerprint: ${describeError(error)}`);
    throw new Error("The privilege check is unavailable right now.");
  }
}

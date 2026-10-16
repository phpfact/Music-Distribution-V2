"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIpFromForwardedFor } from "@/lib/platform-auth/rate-limit";
import { describeError } from "@/lib/platform-auth/session";
import { saveViewerAppearance } from "@/lib/workspace/appearance";
import type { WorkspaceAppearanceActionResult } from "@/lib/workspace/appearance-options";
import { getWorkspace } from "@/lib/workspace/context";
import { WORKSPACE_COOKIES, workspaceCookieOptions } from "@/lib/workspace/cookies";
import { LOGIN_PATH, requireTenantUser } from "@/lib/workspace/guards";
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
 * Description: Save or reset the tenant staff user's appearance (or, for the
 *   owner, the workspace default).
 * Input: The untrusted save request ({ operation, scope, appearance? }).
 * Output: The new appearance state or a friendly error. The user and the owner
 *   flag come from the verified session, never from the request; the server
 *   re-renders /tenant (no full reload) after a committed save.
 * Use case: The tenant Appearance page and the header's theme switch.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function saveTenantAppearanceAction(input: unknown): Promise<WorkspaceAppearanceActionResult> {
  // Step 1: a signed-in tenant staff user of this host (redirects otherwise).
  const area = await requireTenantUser();

  // Step 2: validate and save (workspace scope needs the owner role).
  const clientIp = clientIpFromForwardedFor((await headers()).get("x-forwarded-for"));
  const result   = await saveViewerAppearance(
    area.db,
    { userId: area.user.id, tenantId: area.tenant.id, isOwner: area.user.isOwner },
    input,
    clientIp,
  );

  // Step 3: re-render the tenant area with the new theme.
  if (result.ok) revalidatePath(TENANT_BASE_PATH, "layout");
  return result;
}

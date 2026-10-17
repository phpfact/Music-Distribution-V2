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
import { LOGIN_PATH, readAreaFingerprint, requireCustomer, type AreaFingerprint } from "@/lib/workspace/guards";
import { revokeUserSession } from "@/lib/workspace/sessions";
import { CUSTOMER_BASE_PATH } from "./navigation";

/**
 * Description: Sign the customer out.
 * Input: None (reads the customer area cookie).
 * Output: The session row is deleted in the tenant's database, the cookie is
 *   removed with the same name and path and the browser goes to /login — also
 *   when there was no session. Never returns.
 * Use case: "Log out" in the customer area's account menu (with and without JavaScript).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function customerLogoutAction(): Promise<void> {
  const cookieStore = await cookies();
  const cookie      = WORKSPACE_COOKIES.customer;
  const token       = cookieStore.get(cookie.name)?.value;

  // Step 1: revoke the session (best effort: the cookie goes either way).
  const workspace = await getWorkspace();
  if (token && workspace.state === "ready") {
    try {
      await revokeUserSession(workspace.db, workspace.tenant.id, "customer", token);
      console.log(`[workspace-auth] tenant ${workspace.tenant.id}: customer logout succeeded`);
    } catch (error) {
      console.error(`[workspace-auth] could not revoke a customer session: ${describeError(error)}`);
    }
  }

  // Step 2: delete the cookie with the same name and path it was set with.
  const { httpOnly, secure, sameSite, path } = workspaceCookieOptions("customer");
  cookieStore.delete({ name: cookie.name, httpOnly, secure, sameSite, path });

  // Throws by design, so it stays outside any try/catch.
  redirect(LOGIN_PATH);
}

/**
 * Description: Save or reset the customer's personal appearance.
 * Input: The untrusted save request ({ operation, scope, appearance? }).
 * Output: The new appearance state or a friendly error. Customers never own
 *   the workspace, so a "workspace" scope is always refused by the service.
 * Use case: The customer Appearance page and the header's theme switch.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function saveCustomerAppearanceAction(input: unknown): Promise<WorkspaceAppearanceActionResult> {
  // Step 1: a signed-in customer of this host (redirects otherwise).
  const area = await requireCustomer();

  // Step 2: validate and save (customers never manage the workspace default).
  const clientIp = clientIpFromForwardedFor((await headers()).get("x-forwarded-for"));
  const result   = await saveViewerAppearance(
    area.db,
    { userId: area.user.id, tenantId: area.tenant.id, canManageWorkspace: false },
    input,
    clientIp,
  );

  // Step 3: re-render the customer area with the new theme.
  if (result.ok) revalidatePath(CUSTOMER_BASE_PATH, "layout");
  return result;
}

/**
 * Description: Report whether the customer session is still valid and the hash
 *   of the user's current privileges.
 * Input: None (Host header and the customer area cookie).
 * Output: { signedIn, fingerprint } and nothing else. The session is validated
 *   with touch: false (a background poll never extends the idle timeout); a
 *   suspended customer or main customer counts as signed out. A server error is
 *   logged and answered with a generic error, which the browser ignores.
 * Use case: PermissionSync in the customer layout
 *   (.vibe/memory/role-privilege-management.md).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function customerFingerprintAction(): Promise<AreaFingerprint> {
  try {
    return await readAreaFingerprint("customer");
  } catch (error) {
    console.error(`[authz] could not read the customer privilege fingerprint: ${describeError(error)}`);
    throw new Error("The privilege check is unavailable right now.");
  }
}

"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { authorizePlatformAction } from "@/lib/authz/platform";
import { getPlatformSession } from "@/lib/platform-auth/dal";
import { clientIpFromForwardedFor } from "@/lib/platform-auth/rate-limit";
import { describeError, SESSION_COOKIE_NAME, validateSession } from "@/lib/platform-auth/session";
import { getAppearanceState, saveAppearance } from "@/lib/appearance/service";
import { parseAppearanceUpdate, type Appearance, type AppearanceActionResult } from "@/lib/appearance/preferences";

/**
 * Description: Check that a save request comes from this site.
 * Input: The request headers.
 * Output: False for a cross-site fetch or a missing/foreign Origin (Next's own
 *   origin/host check also applies).
 * Use case: updateAppearanceAction.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function sameOrigin(requestHeaders: Headers): boolean {
  if (requestHeaders.get("sec-fetch-site") === "cross-site") return false;
  const origin = requestHeaders.get("origin");
  const host   = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"))?.split(",")[0]?.trim();
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && url.host === host;
  } catch {
    return false;
  }
}

/**
 * Description: Save or reset an appearance preference (personal or platform default).
 * Input: The operation, scope, appearance (apply only) and the account-switch guard.
 * Output: The new appearance state, or a friendly error (expired session, foreign
 *   origin, invalid input, account changed, missing privilege, save failure).
 *   A global-scope request first goes through authorizePlatformAction(
 *   "platform.appearance.manage_global"), so a refusal is audited as
 *   authz.denied; the service keeps its own in-transaction check. Rendered
 *   pages are revalidated after a committed save; details go to the server log.
 * Use case: Appearance settings' Apply/Default confirmation.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
export async function updateAppearanceAction(input: {
  operation: "apply" | "reset";
  scope: "personal" | "global";
  appearance?: Appearance;
  expectedOwnerId?: string;
}): Promise<AppearanceActionResult> {
  try {
    const session = await getPlatformSession();
    if (!session) return { ok: false, error: "Your session has expired. Sign in again to save appearance settings." };
    const requestHeaders = await headers();
    if (!sameOrigin(requestHeaders)) {
      return { ok: false, error: "This request could not be verified. Refresh the page and try again." };
    }
    const update = parseAppearanceUpdate(input);
    if (!update) return { ok: false, error: "Choose a supported appearance and action." };
    if (update.expectedOwnerId && update.expectedOwnerId !== session.owner.id) {
      return { ok: false, error: "Your account has changed. Refresh the page before saving appearance settings." };
    }
    const ipAddress = clientIpFromForwardedFor(requestHeaders.get("x-forwarded-for"));
    // The platform default needs its privilege; the refusal is audited (personal stays open to everyone).
    if (update.scope === "global") {
      const authorization = await authorizePlatformAction("platform.appearance.manage_global", { ipAddress });
      if (!authorization.ok) return { ok: false, error: authorization.error };
    }
    const result = await saveAppearance(session, update, ipAddress);
    if (result.ok) {
      // Cache invalidation cannot turn a committed save into a reported failure.
      try {
        revalidatePath("/platform", "layout");
      } catch (error) {
        console.error(`[appearance] could not refresh rendered pages: ${describeError(error)}`);
      }
    }
    return result;
  } catch (error) {
    console.error(`[appearance] could not save preferences: ${describeError(error)}`);
    return { ok: false, error: "Appearance settings could not be saved. Please try again." };
  }
}

/**
 * Description: Re-read this account's authoritative appearance.
 * Input: None (reads the session cookie without extending its idle time).
 * Output: The appearance state (global/default for a signed-out browser), or an error.
 * Use case: ThemeRoot's background refresh (other tabs, focus, interval).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function refreshAppearanceAction(): Promise<AppearanceActionResult> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    // Background refreshes must not count as user activity for the idle timeout.
    const session = token ? await validateSession(token, { touch: false }) : null;
    const state   = await getAppearanceState(session?.owner.id);
    return { ok: true, state };
  } catch (error) {
    console.error(`[appearance] could not load preferences: ${describeError(error)}`);
    return { ok: false, error: "Appearance settings could not be loaded. Please try again." };
  }
}

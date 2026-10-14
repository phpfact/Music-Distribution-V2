"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getPlatformSession } from "@/lib/platform-auth/dal";
import { clientIpFromForwardedFor } from "@/lib/platform-auth/rate-limit";
import { describeError, SESSION_COOKIE_NAME, validateSession } from "@/lib/platform-auth/session";
import { getAppearanceState, saveAppearance } from "@/lib/appearance/service";
import { parseAppearanceUpdate, type Appearance, type AppearanceActionResult } from "@/lib/appearance/preferences";

/** Next's origin/host check also applies; this rejects missing or cross-site origins. */
function sameOrigin(requestHeaders: Headers): boolean {
  if (requestHeaders.get("sec-fetch-site") === "cross-site") return false;
  const origin = requestHeaders.get("origin");
  const host = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"))?.split(",")[0]?.trim();
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && url.host === host;
  } catch {
    return false;
  }
}

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
    const result = await saveAppearance(session, update, clientIpFromForwardedFor(requestHeaders.get("x-forwarded-for")));
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

/** Refreshes this account's authoritative preferences for another tab or a global change. */
export async function refreshAppearanceAction(): Promise<AppearanceActionResult> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    // Background refreshes must not count as user activity for the idle timeout.
    const session = token ? await validateSession(token, { touch: false }) : null;
    const state = await getAppearanceState(session?.owner.id);
    return { ok: true, state };
  } catch (error) {
    console.error(`[appearance] could not load preferences: ${describeError(error)}`);
    return { ok: false, error: "Appearance settings could not be loaded. Please try again." };
  }
}

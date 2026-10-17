"use server";
/**
 * Server Action of the platform module switches
 * (.vibe/memory/role-privilege-management.md, "Module switches").
 *
 * A Server Action is a public HTTP endpoint: it authorizes first
 * (authorizePlatformAction; a refusal is audited as authz.denied), the
 * service re-validates every argument and re-checks the privilege in its own
 * transaction, and the result is a plain object with friendly messages only.
 */
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { authorizePlatformAction } from "@/lib/authz/platform";
import type { ModuleToggleResult } from "@/lib/authz/module-model";
import { setPlatformModuleEnabled } from "@/lib/authz/module-service";
import { clientIpFromForwardedFor } from "@/lib/platform-auth/rate-limit";
import { describeError } from "@/lib/platform-auth/session";

/**
 * Description: Switch one platform module on or off for every Platform Owner.
 * Input: The module key and the target state (both untrusted; re-validated by the service).
 * Output: The module's new state (`changed` false when nothing had to change),
 *   or `{ ok: false, reason, error }` with a friendly message. A signed-out
 *   caller is redirected to the login page.
 * Use case: The switches of /platform/settings/modules. After a change the
 *   whole console re-renders on the next navigation (its navigation and pages
 *   depend on the switched privileges).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function setPlatformModuleAction(moduleKey: unknown, enabled: unknown): Promise<ModuleToggleResult> {
  // Step 1: session + CURRENT privilege (refusal audited with the client address).
  const ipAddress     = clientIpFromForwardedFor((await headers()).get("x-forwarded-for"));
  const authorization = await authorizePlatformAction("platform.modules.manage", { ipAddress });
  if (!authorization.ok) return { ok: false, reason: "forbidden", error: authorization.error };

  // Step 2: the service validates and switches (never throws for expected failures).
  const result = await setPlatformModuleEnabled({ ownerId: authorization.session.owner.id }, moduleKey, enabled, ipAddress);

  // Step 3: re-render the console (navigation, dashboard and pages follow the privileges).
  if (result.ok && result.changed) {
    try {
      revalidatePath("/platform", "layout");
    } catch (error) {
      // A cache refresh failure must not report a committed switch as failed.
      console.error(`[modules] could not refresh rendered pages: ${describeError(error)}`);
    }
  }
  return result;
}

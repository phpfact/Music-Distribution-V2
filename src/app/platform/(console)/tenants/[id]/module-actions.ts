"use server";
/**
 * Server Action of the per-tenant module switches ("Module access" section of
 * the tenant details page; .vibe/memory/tenant-management.md and
 * role-privilege-management.md, "Module switches").
 *
 * A Server Action is a public HTTP endpoint: it authorizes first
 * (authorizePlatformAction; a refusal is audited as authz.denied), the
 * service re-validates every argument (tenant id, module key, state) and
 * re-checks the privilege in its own transaction, and the result is a plain
 * object with friendly messages only.
 */
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { authorizePlatformAction } from "@/lib/authz/platform";
import type { ModuleToggleResult } from "@/lib/authz/module-model";
import { setTenantModuleEnabled } from "@/lib/authz/module-service";
import { clientIpFromForwardedFor } from "@/lib/platform-auth/rate-limit";
import { describeError } from "@/lib/platform-auth/session";
import { isUuid } from "@/lib/uuid";

/**
 * Description: Switch one tenant or customer panel module on or off for one tenant.
 * Input: The tenant id, module key and target state (all untrusted; re-validated
 *   by the service).
 * Output: The module's new state (`changed` false when nothing had to change),
 *   or `{ ok: false, reason, error }` with a friendly message. A signed-out
 *   caller is redirected to the login page.
 * Use case: The switches of the tenant details page's "Module access" section.
 *   The tenant's users get the new privileges on their next request (their
 *   guards read the switches on every request); the details page re-renders.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function setTenantModuleAction(
  tenantId: unknown,
  moduleKey: unknown,
  enabled: unknown,
): Promise<ModuleToggleResult> {
  // Step 1: session + CURRENT privilege (refusal audited with the client address).
  const ipAddress     = clientIpFromForwardedFor((await headers()).get("x-forwarded-for"));
  const authorization = await authorizePlatformAction("platform.tenant_modules.manage", { ipAddress });
  if (!authorization.ok) return { ok: false, reason: "forbidden", error: authorization.error };

  // Step 2: the service validates and switches (never throws for expected failures).
  const result = await setTenantModuleEnabled(
    { ownerId: authorization.session.owner.id },
    tenantId,
    moduleKey,
    enabled,
    ipAddress,
  );

  // Step 3: re-render the details page (the id is a validated UUID once the switch succeeded).
  if (result.ok && result.changed && isUuid(tenantId)) {
    try {
      revalidatePath(`/platform/tenants/${tenantId}`);
    } catch (error) {
      // A cache refresh failure must not report a committed switch as failed.
      console.error(`[modules] could not refresh the tenant page: ${describeError(error)}`);
    }
  }
  return result;
}

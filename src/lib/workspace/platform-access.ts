import "server-only";
/**
 * How a Platform Owner reaches one tenant's customer registrations
 * (.vibe/memory/customer-registration.md).
 *
 * The tenant is chosen by id on the platform host (never by a Host header),
 * and only tenants whose setup has completed (active or suspended, current
 * schema) are opened. The caller must already have verified the Platform
 * Owner session (requirePlatformOwner).
 */
import { getControlDb } from "@/lib/db/control";
import type { TenantDb } from "@/lib/db/tenant";
import { describeError } from "@/lib/platform-auth/session";
import { isUuid } from "@/lib/uuid";
import { openTenantDatabase } from "./context";

export type PlatformTenantAccess =
  | { ok: true; tenant: { id: string; name: string; status: "active" | "suspended" }; db: TenantDb }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_ready" | "unavailable"; tenant: { id: string; name: string } };

/**
 * Description: Open a tenant's database for the Platform Owner's registrations page.
 * Input: The tenant id (from the URL or an action argument: untrusted).
 * Output: The tenant and its database client; "not_found" for a bad or unknown
 *   id; "not_ready" while setup has not finished; "unavailable" when the
 *   database cannot be opened (details in the log only).
 * Use case: /platform/tenants/<id>/registrations and its Server Actions.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function openTenantForPlatformOwner(tenantId: string): Promise<PlatformTenantAccess> {
  // Step 1: a well-formed id of an existing tenant.
  if (!isUuid(tenantId)) return { ok: false, reason: "not_found" };
  const tenant = await getControlDb().tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, status: true, schemaStatus: true },
  });
  if (!tenant) return { ok: false, reason: "not_found" };

  // Step 2: only a tenant whose database is set up has registrations.
  const summary = { id: tenant.id, name: tenant.name };
  const ready   = (tenant.status === "active" || tenant.status === "suspended") && tenant.schemaStatus === "current";
  if (!ready) return { ok: false, reason: "not_ready", tenant: summary };

  // Step 3: the tenant's own database.
  try {
    return {
      ok: true,
      tenant: { ...summary, status: tenant.status === "suspended" ? "suspended" : "active" },
      db: await openTenantDatabase(tenant.id),
    };
  } catch (error) {
    console.error(`[registrations] tenant ${tenant.id}: database unavailable for the platform: ${describeError(error)}`);
    return { ok: false, reason: "unavailable", tenant: summary };
  }
}

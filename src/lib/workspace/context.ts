import "server-only";
/**
 * The tenant ("workspace") a tenant-portal request belongs to
 * (.vibe/memory/workspace-auth.md).
 *
 * The tenant comes from the Host header ONLY, through the existing tenant
 * gate (src/lib/domains/resolve.ts). Never from a form field, query string,
 * cookie or X-Forwarded-Host. Tenant data may be touched only when the gate
 * answers "allowed".
 */
import { currentRequestContext } from "@/lib/request-context-server";
import { cache } from "react";
import { headers } from "next/headers";
import { getTenantDb, type TenantDb } from "@/lib/db/tenant";
import { resolveHost, tenantAccessOf, type HostResolution } from "@/lib/domains/resolve";
import { describeError } from "@/lib/platform-auth/session";
import { loadTenantDatabase } from "@/lib/tenants/database-target";

/** What the portal may show about its tenant: the id (server only) and the name. */
export type WorkspaceTenant = { id: string; name: string };

export type Workspace =
  /** Active tenant with a current schema and a reachable database. */
  | { state: "ready"; tenant: WorkspaceTenant; db: TenantDb }
  /** The Platform Owner suspended the tenant. */
  | { state: "suspended"; tenant: WorkspaceTenant }
  /** Setup has not finished (or failed). */
  | { state: "not_ready"; tenant: WorkspaceTenant }
  /** The tenant is allowed but its database configuration could not be loaded. */
  | { state: "unavailable"; tenant: WorkspaceTenant }
  /** No tenant answers to this host (also the platform's own host). */
  | { state: "unknown" };

export type ReadyWorkspace = Extract<Workspace, { state: "ready" }>;

/**
 * Description: Open the Prisma client of one tenant's database.
 * Input: The tenant id (taken from the control plane, never from the request).
 * Output: The cached tenant client; throws TenantDatabaseConfigError when the
 *   database is not configured or its secret cannot be read.
 * Use case: getWorkspace (tenant host) and the Platform Owner registrations page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function openTenantDatabase(tenantId: string): Promise<TenantDb> {
  // Step 1: database name, login and decrypted password from the control plane.
  const target = await loadTenantDatabase(tenantId);
  // Step 2: the shared, size-capped client cache (src/lib/db/tenant.ts).
  return getTenantDb(target);
}

/**
 * Description: Resolve the current request's Host header once per request.
 * Input: None (reads the Host header).
 * Output: "platform", "unknown" or the tenant (existing resolver, one database
 *   lookup). Memoized for one request, so "/" (which must tell the platform host
 *   apart) and getWorkspace share the same lookup.
 * Use case: The root page and getWorkspace.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-17
 */
export const getHostResolution = cache(async (): Promise<HostResolution> => {
  return resolveHost((await headers()).get("host"), await currentRequestContext());
});

/**
 * Description: Resolve the workspace of the current request.
 * Input: None (reads the Host header).
 * Output: The workspace state; "ready" carries the tenant's database client.
 *   Memoized for one request, so pages, layouts and actions share one lookup.
 * Use case: Every tenant-portal page, layout and Server Action (through the guards).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export const getWorkspace = cache(async (): Promise<Workspace> => {
  // Step 1: which tenant (if any) the Host header names, and may it be served.
  const access = tenantAccessOf(await getHostResolution());
  if (access.access === "unknown") return { state: "unknown" };

  const tenant: WorkspaceTenant = { id: access.tenant.id, name: access.tenant.name };
  if (access.access === "suspended") return { state: "suspended", tenant };
  if (access.access === "not_ready") return { state: "not_ready", tenant };

  // Step 2: the tenant's own database (only for an allowed tenant).
  try {
    return { state: "ready", tenant, db: await openTenantDatabase(tenant.id) };
  } catch (error) {
    // The details stay in the log; visitors get a friendly page.
    console.error(`[workspace] tenant ${tenant.id}: database unavailable: ${describeError(error)}`);
    return { state: "unavailable", tenant };
  }
});

import "server-only";
/**
 * Which tenant a request is for, and whether it may be served
 * (docs/tenant-management.md §7.3).
 *
 * EVERY FUTURE TENANT-FACING ROUTE MUST CALL `getTenantAccess` FIRST and serve
 * tenant content only when the answer is `allowed`. Suspended tenants,
 * tenants whose setup has not finished and unknown hosts must never reach
 * tenant data.
 *
 * The tenant comes from the Host header only. Never from a query string,
 * cookie, form field or any other header (X-Forwarded-Host included): those
 * are easier to forge than the host the request was routed by.
 */
import { getControlDb } from "@/lib/db/control";
import { classifyHost, parseHostHeader } from "@/lib/domains/rules";
import { getEnv } from "@/lib/env";
import type { TenantStatus } from "@/app/platform/(console)/tenants/labels";

export type ResolvedTenant = {
  id: string;
  name: string;
  status: TenantStatus;
  schemaStatus: "pending" | "current" | "failed";
};

/** `platform`: the platform's own host; `unknown`: no tenant answers to this host. */
export type HostResolution = "platform" | "unknown" | { tenant: ResolvedTenant };

export type TenantAccess =
  | { access: "allowed"; tenant: ResolvedTenant }
  | { access: "suspended"; tenant: ResolvedTenant }
  /** Setup has not finished (or failed): the tenant exists but cannot be served. */
  | { access: "not_ready"; tenant: ResolvedTenant }
  | { access: "unknown" };

const TENANT_SELECT = { id: true, name: true, status: true, schemaStatus: true } as const;

/**
 * Description: Find which tenant (if any) a request's Host header belongs to.
 * Input: The Host header value.
 * Output: "platform" for IP addresses and the base domain; the tenant for its
 *   subdomain (whatever its DNS state) or for a verified (active) custom domain;
 *   otherwise "unknown". Nobody can claim a host by merely typing it into the form.
 * Use case: getTenantAccess (the tenant gate).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function resolveHost(hostHeader: string | null | undefined): Promise<HostResolution> {
  const host = parseHostHeader(hostHeader);
  if (!host) return "unknown";
  const hostClass = classifyHost(host, getEnv().platformBaseDomain);
  if (hostClass.kind === "ip" || hostClass.kind === "base") return "platform";

  const domain = await getControlDb().tenantDomain.findFirst({
    where:
      hostClass.kind === "subdomain"
        ? { type: "subdomain", hostname: hostClass.label }
        : { type: "custom", hostname: host, status: "active" },
    select: { tenant: { select: TENANT_SELECT } },
  });
  return domain ? { tenant: domain.tenant } : "unknown";
}

/**
 * Description: Decide whether a resolved tenant may be served.
 * Input: The host resolution.
 * Output: "allowed" for an active tenant with a current schema, "suspended",
 *   "not_ready" (setup unfinished or failed), or "unknown" (also for the platform host).
 * Use case: getTenantAccess; unit tests.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function tenantAccessOf(resolution: HostResolution): TenantAccess {
  if (resolution === "platform" || resolution === "unknown") return { access: "unknown" };
  const { tenant } = resolution;
  if (tenant.status === "active" && tenant.schemaStatus === "current") return { access: "allowed", tenant };
  if (tenant.status === "suspended") return { access: "suspended", tenant };
  return { access: "not_ready", tenant };
}

/**
 * Description: The tenant gate every tenant-facing route must call first.
 * Input: The request's Host header.
 * Output: The access decision; tenant content may be served only when it is "allowed".
 * Use case: The root host gate and every future tenant route.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function getTenantAccess(hostHeader: string | null | undefined): Promise<TenantAccess> {
  return tenantAccessOf(await resolveHost(hostHeader));
}

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
 * IP addresses and the base domain are the platform. Exactly one label in
 * front of the base domain is a subdomain (looked up whatever its DNS state:
 * the tenant's own status decides access). Any other host is a custom domain
 * and counts only once verified (`active`), so nobody can claim a host by
 * merely typing it into the form.
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

/** The access decision for a resolved host. The platform host is no tenant: `unknown`. */
export function tenantAccessOf(resolution: HostResolution): TenantAccess {
  if (resolution === "platform" || resolution === "unknown") return { access: "unknown" };
  const { tenant } = resolution;
  if (tenant.status === "active" && tenant.schemaStatus === "current") return { access: "allowed", tenant };
  if (tenant.status === "suspended") return { access: "suspended", tenant };
  return { access: "not_ready", tenant };
}

/** The tenant gate: `allowed` only for an active tenant whose schema is current. */
export async function getTenantAccess(hostHeader: string | null | undefined): Promise<TenantAccess> {
  return tenantAccessOf(await resolveHost(hostHeader));
}

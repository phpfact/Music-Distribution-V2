import "server-only";
/**
 * Checking a tenant's domains on demand (docs/tenant-management.md §7.2):
 * the custom domain's TXT proof ("Check DNS") and the SaaS subdomain's
 * resolution. The app never creates DNS records; it only looks.
 *
 * The DNS answer arrives after a network round trip, so every row update is
 * conditional on the host name still being the one that was checked: an edit
 * made meanwhile is never overwritten with a stale verdict.
 */
import { recordAudit } from "@/lib/audit";
import { getControlDb } from "@/lib/db/control";
import { checkCustomDomainDns, checkSubdomainDns, type DnsResolver } from "@/lib/domains/dns";
import { getEnv } from "@/lib/env";
import { describeError } from "@/lib/platform-auth/session";
import { consumeRateLimit } from "@/lib/rate-limit";
import { isUuid, ownerAudit, type ServiceFailure, type TenantActor, UNAVAILABLE_MESSAGE } from "./common";

export type DomainCheckResult =
  | { ok: true; status: "active" }
  /** `dns`: the check ran and failed; the message says which record to add. */
  | ServiceFailure<"not_found" | "invalid_state" | "dns" | "rate_limited" | "unavailable">;

/** For tests: a fake resolver instead of real DNS. */
export type DomainCheckDeps = { dnsResolver?: DnsResolver };

const NOT_FOUND   = { ok: false, reason: "not_found", message: "This tenant does not exist." } as const;
const UNAVAILABLE = { ok: false, reason: "unavailable", message: UNAVAILABLE_MESSAGE } as const;

// Each check is a DNS query on the owner's behalf: bounded per owner, shared by both checks.
const CHECK_LIMIT = { limit: 30, windowSeconds: 5 * 60 };

/** `tenant_domains.last_check_error` is VARCHAR(300). */
const CHECK_ERROR_MAX_LENGTH = 300;

/**
 * Description: Fit a check message into the last_check_error column.
 * Input: The message.
 * Output: The message, cut to 300 characters with an ellipsis when longer.
 * Use case: recordVerdict.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function clip(message: string): string {
  return message.length <= CHECK_ERROR_MAX_LENGTH
    ? message
    : `${message.slice(0, CHECK_ERROR_MAX_LENGTH - 1)}…`;
}

/**
 * Description: Rate-limit DNS checks per owner.
 * Input: The acting owner.
 * Output: null when allowed; otherwise the rate-limited (30 per 5 minutes) or
 *   unavailable result. Each check is a DNS query on the owner's behalf.
 * Use case: verifyCustomDomain and recheckSubdomain.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
async function limitChecks(actor: TenantActor): Promise<DomainCheckResult | null> {
  const limit = await consumeRateLimit({ key: `tenant-domain-check:${actor.ownerId}`, ...CHECK_LIMIT });
  if (limit === "limited") {
    return {
      ok: false,
      reason: "rate_limited",
      message: "DNS was checked too often. Wait a few minutes, then try again.",
    };
  }
  return limit === "unavailable" ? UNAVAILABLE : null;
}

type DomainRow = { id: string; hostname: string; status: string; verificationToken: string | null };

/**
 * Description: Load one domain row of a tenant.
 * Input: The tenant id and the domain type.
 * Output: Whether the tenant exists and its row of that type (or null).
 * Use case: verifyCustomDomain and recheckSubdomain.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
async function findDomain(
  tenantId: string,
  type: "subdomain" | "custom",
): Promise<{ tenant: false } | { tenant: true; row: DomainRow | null }> {
  const tenant = await getControlDb().tenant.findUnique({
    where: { id: tenantId },
    select: {
      domains: {
        where: { type },
        select: { id: true, hostname: true, status: true, verificationToken: true },
      },
    },
  });
  if (!tenant) return { tenant: false };
  return { tenant: true, row: tenant.domains[0] ?? null };
}

/**
 * Description: Record a DNS check's verdict on the domain row.
 * Input: The tenant id, the checked row (id and host name), the verdict and
 *   the audit details (acting owner and domain type), or null for no audit.
 * Output: Nothing. A pass makes the row active (audited as tenant.domain_verified when
 *   it was not active and an actor is given); a failure keeps the status and stores
 *   the reason. Only if the row still has the checked host name.
 * Use case: Every domain check.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
async function recordVerdict(
  tenantId: string,
  row: { id: string; hostname: string },
  verdict: { ok: true } | { ok: false; message: string },
  audit: { actor: TenantActor; domainType: "subdomain" | "custom" } | null,
): Promise<void> {
  const now   = new Date();
  const db    = getControlDb();
  const where = { id: row.id, tenantId, hostname: row.hostname };
  if (!verdict.ok) {
    await db.tenantDomain.updateMany({
      where,
      data: { lastCheckedAt: now, lastCheckError: clip(verdict.message) },
    });
    return;
  }
  await db.$transaction(async (tx) => {
    const { count } = await tx.tenantDomain.updateMany({
      where: { ...where, status: { not: "active" } },
      data: { status: "active", verifiedAt: now, lastCheckedAt: now, lastCheckError: null },
    });
    if (count === 1) {
      if (audit) {
        await recordAudit(tx, {
          ...ownerAudit(audit.actor),
          tenantId,
          action: "tenant.domain_verified",
          targetType: "tenant_domain",
          targetId: row.id,
          metadata: { domainType: audit.domainType },
        });
      }
      return;
    }
    // Already active: only the time of this check changes.
    await tx.tenantDomain.updateMany({ where, data: { lastCheckedAt: now, lastCheckError: null } });
  });
}

/**
 * Description: Check a tenant's subdomain right away and record the verdict.
 * Input: The tenant id and the subdomain label.
 * Output: Nothing; never throws.
 * Use case: After a subdomain edit.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function checkSubdomainRow(
  tenantId: string,
  label: string,
  resolver?: DnsResolver,
): Promise<{ status: "active" } | { status: "pending"; message: string }> {
  try {
    const row = await getControlDb().tenantDomain.findFirst({
      where: { tenantId, type: "subdomain", hostname: label },
      select: { id: true, hostname: true },
    });
    if (!row) return { status: "pending", message: "The subdomain is not on record." };
    const verdict = await checkSubdomainDns(label, getEnv().platformBaseDomain, resolver);
    await recordVerdict(tenantId, row, verdict, null);
    return verdict.ok ? { status: "active" } : { status: "pending", message: verdict.message };
  } catch (error) {
    console.error(`[tenants] subdomain check of tenant ${tenantId} failed: ${describeError(error)}`);
    return { status: "pending", message: UNAVAILABLE_MESSAGE };
  }
}

// ---------------------------------------------------------------------------

/**
 * Description: "Check DNS" for the custom domain: the TXT proof and the address.
 * Input: The tenant id and the acting owner.
 * Output: ok (row active, audited) or a failure with the reason (row stays pending).
 * Use case: The details page's Check DNS button.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function verifyCustomDomain(
  id: string,
  actor: TenantActor,
  deps: DomainCheckDeps = {},
): Promise<DomainCheckResult> {
  if (!isUuid(id)) return NOT_FOUND;
  const limited = await limitChecks(actor);
  if (limited) return limited;

  try {
    const found = await findDomain(id, "custom");
    if (!found.tenant) return NOT_FOUND;
    const row = found.row;
    if (!row) return { ok: false, reason: "invalid_state", message: "This tenant has no custom domain." };
    if (row.status === "active") return { ok: true, status: "active" };
    if (!row.verificationToken) {
      return {
        ok: false,
        reason: "invalid_state",
        message: "This domain has no verification token. Remove it and add it again.",
      };
    }

    const verdict = await checkCustomDomainDns(row.hostname, row.verificationToken, deps.dnsResolver);
    await recordVerdict(id, row, verdict, { actor, domainType: "custom" });
    return verdict.ok ? { ok: true, status: "active" } : { ok: false, reason: "dns", message: verdict.message };
  } catch (error) {
    console.error(`[tenants] custom domain check of tenant ${id} failed: ${describeError(error)}`);
    return UNAVAILABLE;
  }
}

/**
 * Description: Re-run the subdomain DNS check.
 * Input: The tenant id and the acting owner.
 * Output: ok (row active; audited only when it was not active before) or the
 *   reason; a failure leaves the status as it was, like the provisioning verify step.
 * Use case: The details page's Re-check button.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function recheckSubdomain(
  id: string,
  actor: TenantActor,
  deps: DomainCheckDeps = {},
): Promise<DomainCheckResult> {
  if (!isUuid(id)) return NOT_FOUND;
  const limited = await limitChecks(actor);
  if (limited) return limited;

  try {
    const found = await findDomain(id, "subdomain");
    if (!found.tenant) return NOT_FOUND;
    const row = found.row;
    if (!row) return { ok: false, reason: "invalid_state", message: "This tenant has no SaaS subdomain on record." };

    const verdict = await checkSubdomainDns(row.hostname, getEnv().platformBaseDomain, deps.dnsResolver);
    await recordVerdict(id, row, verdict, { actor, domainType: "subdomain" });
    return verdict.ok ? { ok: true, status: "active" } : { ok: false, reason: "dns", message: verdict.message };
  } catch (error) {
    console.error(`[tenants] subdomain check of tenant ${id} failed: ${describeError(error)}`);
    return UNAVAILABLE;
  }
}

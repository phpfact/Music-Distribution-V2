import "server-only";
/**
 * DNS checks for tenant domains (docs/tenant-management.md §7.2).
 *
 * The resolver is injectable so tests never touch real DNS. Failures come
 * back as messages that tell the owner which record to add; raw resolver
 * errors are not shown (they can name internal DNS servers).
 */
import { lookup as dnsLookup, Resolver } from "node:dns/promises";
import { verificationRecord } from "@/lib/domains/rules";
import { withTimeout } from "@/lib/with-timeout";

export type DnsResolver = {
  /** The addresses the host resolves to (A/AAAA, or via CNAME). */
  lookup(host: string): Promise<string[]>;
  /** Every TXT record at the name, each as its character strings. */
  resolveTxt(name: string): Promise<string[][]>;
};

export type DnsCheckResult = { ok: true } | { ok: false; message: string };

const DNS_TIMEOUT_MS = 5_000;

class DnsTimeoutError extends Error {
  readonly code = "ETIMEOUT";
}

/**
 * Description: Bound one DNS query in time.
 * Input: The query to run.
 * Output: Its result, or a DnsTimeoutError (code ETIMEOUT) after DNS_TIMEOUT_MS.
 *   getaddrinfo has no timeout of its own, so every call is raced against one
 *   (shared withTimeout helper).
 * Use case: The default resolver's lookup and resolveTxt.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function withDnsTimeout<T>(work: () => Promise<T>): Promise<T> {
  return withTimeout(work, DNS_TIMEOUT_MS, () => new DnsTimeoutError("DNS query timed out"));
}

/**
 * Description: Build the real DNS resolver used outside tests.
 * Input: None.
 * Output: A DnsResolver whose lookup (getaddrinfo, all addresses) and resolveTxt
 *   (one try, 5-second timeout) are bounded in time.
 * Use case: getDefaultResolver.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function createDefaultResolver(): DnsResolver {
  const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 });
  return {
    async lookup(host) {
      const addresses = await withDnsTimeout(() => dnsLookup(host, { all: true }));
      return addresses.map((entry) => entry.address);
    },
    resolveTxt(name) {
      return withDnsTimeout(() => resolver.resolveTxt(name));
    },
  };
}

let defaultResolver: DnsResolver | undefined;

/**
 * Description: Return the shared default resolver, creating it on first use.
 * Input: None.
 * Output: The DnsResolver.
 * Use case: Default argument of the DNS checks (tests inject their own).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function getDefaultResolver(): DnsResolver {
  defaultResolver ??= createDefaultResolver();
  return defaultResolver;
}

// "The name has no such record" as opposed to "DNS did not answer".
const NOT_FOUND_CODES = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN", "EAI_NONAME", "EAI_NODATA"]);

/**
 * Description: Read the error code of a resolver error.
 * Input: Any thrown value.
 * Output: Its `code` as text, or "" when there is none.
 * Use case: isNotFound and lookupFailedMessage.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return "";
}

/**
 * Description: Tell "the name has no such record" apart from "DNS did not answer".
 * Input: Any thrown value.
 * Output: True for the not-found codes (ENOTFOUND, ENODATA, NXDOMAIN, EAI_*).
 * Use case: resolvesTo and checkCustomDomainDns.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function isNotFound(error: unknown): boolean {
  return NOT_FOUND_CODES.has(errorCode(error));
}

/**
 * Description: Word a DNS failure for the owner.
 * Input: The queried name and the error.
 * Output: A timed-out or failed message with "Try again in a few minutes"; raw
 *   resolver errors are never shown (they can name internal DNS servers).
 * Use case: resolvesTo and checkCustomDomainDns.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function lookupFailedMessage(name: string, error: unknown): string {
  return errorCode(error) === "ETIMEOUT"
    ? `The DNS lookup for ${name} timed out. Try again in a few minutes.`
    : `The DNS lookup for ${name} failed. Try again in a few minutes.`;
}

/**
 * Description: Check that a host resolves to at least one address.
 * Input: The resolver, the host and the hint telling the owner what to add.
 * Output: null when the host resolves, otherwise the message saying why not.
 * Use case: checkSubdomainDns and checkCustomDomainDns.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
async function resolvesTo(resolver: DnsResolver, host: string, hint: string): Promise<string | null> {
  try {
    const addresses = await resolver.lookup(host);
    return addresses.length > 0 ? null : `${host} does not resolve. ${hint}`;
  } catch (error) {
    return isNotFound(error) ? `${host} does not resolve. ${hint}` : lookupFailedMessage(host, error);
  }
}

/**
 * Description: Tell whether the platform runs under localhost.
 * Input: PLATFORM_BASE_DOMAIN.
 * Output: True for localhost and *.localhost.
 * Use case: checkSubdomainDns (RFC 6761: nothing to check in development).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function isLocalhostBase(baseDomain: string): boolean {
  return baseDomain === "localhost" || baseDomain.endsWith(".localhost");
}

/**
 * Description: Check that a tenant's SaaS subdomain resolves.
 * Input: The subdomain label, PLATFORM_BASE_DOMAIN and an optional resolver.
 * Output: ok, or a message asking for the wildcard record *.<base>. Always ok under
 *   localhost (browsers resolve *.localhost without DNS).
 * Use case: Provisioning's verify step and "Re-check subdomain".
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function checkSubdomainDns(
  label: string,
  baseDomain: string,
  resolver: DnsResolver = getDefaultResolver(),
): Promise<DnsCheckResult> {
  // RFC 6761: *.localhost always means loopback, and browsers resolve it
  // without asking DNS, so there is nothing to check in development.
  if (isLocalhostBase(baseDomain)) return { ok: true };
  const host = `${label}.${baseDomain}`;
  const problem = await resolvesTo(
    resolver,
    host,
    `Add a wildcard DNS record *.${baseDomain} pointing to the application, then retry.`,
  );
  return problem ? { ok: false, message: problem } : { ok: true };
}

/**
 * Description: Verify control of a custom domain and that it points to the application.
 * Input: The custom host, its verification token and an optional resolver.
 * Output: ok, or a message saying which TXT record is missing or wrong, or that the
 *   host does not resolve. A long TXT record split into strings is joined first.
 * Use case: "Check DNS" on the details page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function checkCustomDomainDns(
  host: string,
  token: string,
  resolver: DnsResolver = getDefaultResolver(),
): Promise<DnsCheckResult> {
  const record    = verificationRecord(host, token);
  const addRecord = `Add a TXT record named ${record.name} with the value ${record.value}, then retry.`;

  let records: string[][];
  try {
    records = await resolver.resolveTxt(record.name);
  } catch (error) {
    if (!isNotFound(error)) return { ok: false, message: lookupFailedMessage(record.name, error) };
    records = [];
  }
  if (records.length === 0) {
    return { ok: false, message: `No TXT record was found at ${record.name}. ${addRecord}` };
  }
  // A long TXT record arrives split into several strings; they form one value.
  if (!records.some((parts) => parts.join("").trim() === record.value)) {
    return {
      ok: false,
      message: `The TXT records at ${record.name} do not contain ${record.value}. ${addRecord} DNS changes can take a while to appear.`,
    };
  }

  const problem = await resolvesTo(
    resolver,
    host,
    "Point it to the application with an A, AAAA or CNAME record, then retry.",
  );
  return problem ? { ok: false, message: problem } : { ok: true };
}

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

/** getaddrinfo has no timeout of its own, so every call is raced against one. */
async function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DnsTimeoutError("DNS query timed out")), DNS_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function createDefaultResolver(): DnsResolver {
  const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 });
  return {
    async lookup(host) {
      const addresses = await withTimeout(dnsLookup(host, { all: true }));
      return addresses.map((entry) => entry.address);
    },
    resolveTxt(name) {
      return withTimeout(resolver.resolveTxt(name));
    },
  };
}

let defaultResolver: DnsResolver | undefined;

function getDefaultResolver(): DnsResolver {
  defaultResolver ??= createDefaultResolver();
  return defaultResolver;
}

// "The name has no such record" as opposed to "DNS did not answer".
const NOT_FOUND_CODES = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN", "EAI_NONAME", "EAI_NODATA"]);

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return "";
}

function isNotFound(error: unknown): boolean {
  return NOT_FOUND_CODES.has(errorCode(error));
}

function lookupFailedMessage(name: string, error: unknown): string {
  return errorCode(error) === "ETIMEOUT"
    ? `The DNS lookup for ${name} timed out. Try again in a few minutes.`
    : `The DNS lookup for ${name} failed. Try again in a few minutes.`;
}

/** null when the host resolves, otherwise why not. */
async function resolvesTo(resolver: DnsResolver, host: string, hint: string): Promise<string | null> {
  try {
    const addresses = await resolver.lookup(host);
    return addresses.length > 0 ? null : `${host} does not resolve. ${hint}`;
  } catch (error) {
    return isNotFound(error) ? `${host} does not resolve. ${hint}` : lookupFailedMessage(host, error);
  }
}

function isLocalhostBase(baseDomain: string): boolean {
  return baseDomain === "localhost" || baseDomain.endsWith(".localhost");
}

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

export async function checkCustomDomainDns(
  host: string,
  token: string,
  resolver: DnsResolver = getDefaultResolver(),
): Promise<DnsCheckResult> {
  const record = verificationRecord(host, token);
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

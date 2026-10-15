/**
 * Host names: tenant subdomain labels, custom domains and request hosts
 * (docs/tenant-management.md §4, §7).
 *
 * Pure, so client components can import it: no `server-only`, no `node:`
 * imports. Converting an internationalized custom domain to its ASCII form
 * needs `node:url` and happens on the server first (domains/idn.ts).
 */
import type { RuleResult } from "@/lib/tenants/rules";

// ---------------------------------------------------------------------------
// Subdomain labels

export const SUBDOMAIN_LABEL_MIN_LENGTH = 3;
export const SUBDOMAIN_LABEL_MAX_LENGTH = 63;
const SUBDOMAIN_LABEL_PATTERN           = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Labels the platform itself uses or may use, or that look official to visitors. */
export const RESERVED_SUBDOMAINS: readonly string[] = [
  "www", "api", "app", "admin", "administrator", "platform", "dashboard", "console",
  "auth", "login", "logout", "signin", "signup", "register", "account", "accounts",
  "billing", "pay", "payments", "mail", "email", "smtp", "imap", "pop", "ftp",
  "ns", "ns1", "ns2", "dns", "cdn", "static", "assets", "media", "files",
  "upload", "uploads", "img", "images", "status", "health", "support", "help",
  "docs", "blog", "news", "root", "system", "internal", "staging", "dev", "test",
  "demo", "localhost",
];

/**
 * Description: Bring a typed subdomain label into its stored form.
 * Input: The raw text.
 * Output: The text trimmed and lower-cased.
 * Use case: validateSubdomainLabel and searches by subdomain.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function normalizeSubdomainLabel(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Description: Check a tenant's SaaS subdomain label.
 * Input: The raw text (normalized here).
 * Output: The label, or the message for the first broken rule: required; 3–63
 *   lower-case letters, digits or hyphens, starting and ending with a letter or
 *   digit; not xn-- (punycode look-alikes); not a reserved platform label.
 * Use case: Create (Manual domain section), edit and the tenant services.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function validateSubdomainLabel(input: string): RuleResult<string> {
  const label = normalizeSubdomainLabel(input);
  if (label.length === 0) return { ok: false, error: "Enter a subdomain." };
  if (
    label.length < SUBDOMAIN_LABEL_MIN_LENGTH ||
    label.length > SUBDOMAIN_LABEL_MAX_LENGTH ||
    !SUBDOMAIN_LABEL_PATTERN.test(label)
  ) {
    return {
      ok: false,
      error: `Use ${SUBDOMAIN_LABEL_MIN_LENGTH}–${SUBDOMAIN_LABEL_MAX_LENGTH} characters: lower-case letters, digits or hyphens, starting and ending with a letter or digit.`,
    };
  }
  // An xn-- label is punycode: it would display as a different, possibly
  // look-alike, name in the browser.
  if (label.startsWith("xn--")) {
    return { ok: false, error: "Choose a subdomain that does not start with xn--." };
  }
  if (RESERVED_SUBDOMAINS.includes(label)) {
    return { ok: false, error: `${label} is reserved. Choose another subdomain.` };
  }
  return { ok: true, value: label };
}

// ---------------------------------------------------------------------------
// Custom domains

export const CUSTOM_DOMAIN_MAX_LENGTH = 253;
const DNS_LABEL_PATTERN               = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
// Special-use and private top-level names: no public DNS can verify them.
const UNUSABLE_TOP_LEVEL_DOMAINS = [
  "local",
  "localhost",
  "test",
  "example",
  "invalid",
  "internal",
  "onion",
];

/**
 * Description: Bring a host name into its stored and compared form.
 * Input: The raw host text.
 * Output: The host trimmed, lower-cased and without the trailing root dot.
 * Use case: Custom domains, the base domain and request hosts.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function normalizeHostName(input: string): string {
  const host = input.trim().toLowerCase();
  return host.endsWith(".") ? host.slice(0, -1) : host;
}

/**
 * Description: Check a custom domain (ASCII/punycode form) a tenant wants to use.
 * Input: The host (the server converts internationalized names first, domains/idn.ts)
 *   and PLATFORM_BASE_DOMAIN.
 * Output: The normalized host, or the message for the first broken rule: required,
 *   ASCII, not an IP address, at most 253 characters of valid DNS labels with a
 *   dot, a non-numeric and publicly verifiable top-level domain, and not under the
 *   platform's own base domain.
 * Use case: Create and edit forms (client feedback for ASCII input) and the server.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function validateCustomDomain(input: string, baseDomain: string): RuleResult<string> {
  const host = normalizeHostName(input);
  if (host.length === 0) return { ok: false, error: "Enter a domain such as music.example.com." };
  if (!/^[\x00-\x7f]*$/.test(host)) {
    return {
      ok: false,
      error: "Internationalized domains are converted to their xn-- form when you save; check the spelling.",
    };
  }
  if (isIpAddress(host)) {
    return { ok: false, error: "Use a domain name, not an IP address." };
  }
  const labels = host.split(".");
  if (
    host.length > CUSTOM_DOMAIN_MAX_LENGTH ||
    labels.length < 2 ||
    !labels.every((label) => DNS_LABEL_PATTERN.test(label))
  ) {
    return {
      ok: false,
      error: "Enter a full domain such as music.example.com: letters, digits and hyphens, separated by dots.",
    };
  }
  const topLevel = labels[labels.length - 1] ?? "";
  if (/^[0-9]+$/.test(topLevel)) {
    return { ok: false, error: "Use a domain whose last part is not a number." };
  }
  if (UNUSABLE_TOP_LEVEL_DOMAINS.includes(topLevel)) {
    return { ok: false, error: `.${topLevel} domains cannot be verified. Use a public domain.` };
  }
  const base = normalizeHostName(baseDomain);
  if (host === base || host.endsWith(`.${base}`)) {
    return {
      ok: false,
      error: `Domains under ${base} are the platform's own. Use the subdomain field for those, or enter a domain you own.`,
    };
  }
  return { ok: true, value: host };
}

// ---------------------------------------------------------------------------
// Request hosts

// Host names as they appear in a Host header: letters, digits, hyphens and
// (seen in the wild on internal names) underscores, in dot-separated labels.
const HOST_NAME_PATTERN = /^[a-z0-9_-]{1,63}(\.[a-z0-9_-]{1,63})*$/;
const IPV4_PATTERN      = /^(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$/;
const HEX_GROUP         = /^[0-9a-f]{1,4}$/;

/**
 * Description: Check the optional port part of a Host header.
 * Input: The port text, or undefined when the header has none.
 * Output: True for no port or 0–65535 in digits.
 * Use case: parseHostHeader.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function isValidPort(text: string | undefined): boolean {
  return text === undefined || (/^[0-9]{1,5}$/.test(text) && Number(text) <= 65535);
}

/**
 * Description: Read the host from a Host header.
 * Input: The header value (or null/undefined).
 * Output: The host without the port, lower-case and without the root dot; IPv6
 *   addresses without brackets; null for anything that is not a plausible host.
 * Use case: The proxy (platform-only routes) and tenant host resolution.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function parseHostHeader(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().toLowerCase();
  if (text.length === 0) return null;

  if (text.startsWith("[")) {
    const match = /^\[([0-9a-f:.]+)\](?::([^:]*))?$/.exec(text);
    if (!match || !isValidPort(match[2])) return null;
    const address = match[1] ?? "";
    return isIpv6(address) ? address : null;
  }

  const match = /^([^:]+)(?::([^:]*))?$/.exec(text);
  if (!match || !isValidPort(match[2])) return null;
  let host = match[1] ?? "";
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.length === 0 || host.length > 253 || !HOST_NAME_PATTERN.test(host)) return null;
  return host;
}

/**
 * Description: Check whether a text is an IPv6 address.
 * Input: The address without brackets.
 * Output: True for a well-formed IPv6 address (with "::" compression or an embedded IPv4 tail).
 * Use case: parseHostHeader and isIpAddress.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function isIpv6(text: string): boolean {
  let address = text;
  // An embedded IPv4 address (::ffff:1.2.3.4) takes the place of two groups.
  const lastColon = address.lastIndexOf(":");
  const tail      = address.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (!IPV4_PATTERN.test(tail)) return false;
    address = `${address.slice(0, lastColon + 1)}0:0`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return false;
  const groups = halves.flatMap((half) => (half === "" ? [] : half.split(":")));
  if (!groups.every((group) => HEX_GROUP.test(group))) return false;
  // With "::" at least one group is compressed away; without it, all 8 are written.
  return halves.length === 2 ? groups.length < 8 : groups.length === 8;
}

/**
 * Description: Check whether a host is an IP address.
 * Input: A host (IPv6 with or without brackets).
 * Output: True for dotted-decimal IPv4 or valid IPv6.
 * Use case: Platform host detection and custom-domain validation.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function isIpAddress(host: string): boolean {
  const text = host.toLowerCase();
  if (IPV4_PATTERN.test(text)) return true;
  const unbracketed = text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text;
  return unbracketed.includes(":") && isIpv6(unbracketed);
}

export type HostClass =
  | { kind: "ip" }
  | { kind: "base" }
  | { kind: "subdomain"; label: string }
  | { kind: "other" };

/**
 * Description: Classify a request host relative to the platform's base domain.
 * Input: A host from parseHostHeader and PLATFORM_BASE_DOMAIN.
 * Output: "ip", "base", "subdomain" (exactly one label in front of the base
 *   domain; deeper names are never ours) or "other" (a custom domain).
 * Use case: Tenant host resolution.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function classifyHost(host: string, baseDomain: string): HostClass {
  if (isIpAddress(host)) return { kind: "ip" };
  const base = normalizeHostName(baseDomain);
  if (host === base) return { kind: "base" };
  if (host.endsWith(`.${base}`)) {
    const label = host.slice(0, -(base.length + 1));
    if (label.length > 0 && !label.includes(".")) return { kind: "subdomain", label };
  }
  return { kind: "other" };
}

/**
 * Description: Build a tenant's full SaaS host.
 * Input: The subdomain label and PLATFORM_BASE_DOMAIN.
 * Output: "<label>.<base>".
 * Use case: Directory, details page and the success panel.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function subdomainHost(label: string, baseDomain: string): string {
  return `${label}.${normalizeHostName(baseDomain)}`;
}

/**
 * Description: Build the DNS TXT record that proves control of a custom domain (§7.2).
 * Input: The custom host and its verification token.
 * Output: The record name `_md-verify.<host>` and value `md-verify=<token>`.
 * Use case: The details page instructions and the DNS check.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function verificationRecord(
  host: string,
  token: string,
): { name: `_md-verify.${string}`; value: `md-verify=${string}` } {
  return { name: `_md-verify.${host}`, value: `md-verify=${token}` };
}

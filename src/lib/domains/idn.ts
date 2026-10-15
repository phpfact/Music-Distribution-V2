import "server-only";
/**
 * Internationalized custom domains (docs/tenant-management.md §4).
 *
 * `domainToASCII` (WHATWG URL, UTS #46) needs node:url, so the conversion runs
 * on the server; the pure rules in domains/rules.ts then check the ASCII form,
 * which is also what DNS and the Host header use.
 */
import { domainToASCII } from "node:url";
import { normalizeHostName, validateCustomDomain } from "@/lib/domains/rules";
import type { RuleResult } from "@/lib/tenants/rules";

/**
 * Description: Convert a typed custom domain to its ASCII form and validate it.
 * Input: The raw text (may be internationalized) and PLATFORM_BASE_DOMAIN.
 * Output: The punycode host, or the error message (validateCustomDomain's rules, or
 *   "Enter a valid domain" when the name cannot be converted).
 * Use case: Tenant create and edit services (server side; needs node:url).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function normalizeCustomDomainInput(raw: string, baseDomain: string): RuleResult<string> {
  const host = normalizeHostName(raw);
  if (host.length === 0) return validateCustomDomain(host, baseDomain);
  // Returns "" for anything that is not a valid domain (e.g. forbidden code points).
  const ascii = domainToASCII(host);
  if (ascii.length === 0) {
    return { ok: false, error: "Enter a valid domain such as music.example.com." };
  }
  return validateCustomDomain(ascii, baseDomain);
}

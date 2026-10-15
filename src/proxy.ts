/**
 * Next.js Proxy (the file convention formerly called middleware): keeps the
 * platform console off tenant hosts (docs/tenant-management.md §7.3).
 *
 * `/platform/**` answers only on the platform's own host: the base domain,
 * `localhost` or an IP address. On a tenant subdomain or custom domain it
 * does not exist (404), so a tenant's visitors never see the platform login
 * and a tenant host cannot be used to reach the console.
 *
 * Pure string logic on the Host header: no database, no session, so it is
 * cheap and cannot fail on an outage. The pages behind it still check the
 * platform session themselves.
 */
import { type NextRequest, NextResponse } from "next/server";
import { isIpAddress, normalizeHostName, parseHostHeader } from "@/lib/domains/rules";

const DEFAULT_BASE_DOMAIN = "localhost";

/**
 * Description: Tell whether a Host header names the platform's own host.
 * Input: The Host header and PLATFORM_BASE_DOMAIN.
 * Output: True for localhost, an IP address or the base domain; false for a tenant
 *   host or an unparseable/missing header.
 * Use case: proxy (the console exists only on the platform host).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function isPlatformHost(hostHeader: string | null | undefined, baseDomain: string): boolean {
  const host = parseHostHeader(hostHeader);
  if (!host) return false;
  if (host === "localhost" || isIpAddress(host)) return true;
  return host === normalizeHostName(baseDomain);
}

/**
 * Description: Read PLATFORM_BASE_DOMAIN per request at runtime.
 * Input: None.
 * Output: The configured base domain, or "localhost" (same default as src/lib/env.ts).
 * Use case: proxy (the proxy runs on Node.js; the value is not inlined at build time).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function platformBaseDomain(): string {
  return process.env.PLATFORM_BASE_DOMAIN?.trim() || DEFAULT_BASE_DOMAIN;
}

/**
 * Description: Keep /platform/** off tenant hosts.
 * Input: The incoming request.
 * Output: The request continues on the platform host; on a tenant subdomain or custom
 *   domain a plain 404 (a tenant host can never reach the console or its login).
 * Use case: Next.js Proxy for the /platform/:path* matcher.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function proxy(request: NextRequest): NextResponse {
  if (isPlatformHost(request.headers.get("host"), platformBaseDomain())) return NextResponse.next();
  return new NextResponse("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
}

export const config = {
  matcher: "/platform/:path*",
};

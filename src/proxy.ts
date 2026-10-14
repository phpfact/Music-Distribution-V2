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
 * Whether a Host header names the platform's own host. An unparseable or
 * missing header is not the platform.
 */
export function isPlatformHost(hostHeader: string | null | undefined, baseDomain: string): boolean {
  const host = parseHostHeader(hostHeader);
  if (!host) return false;
  if (host === "localhost" || isIpAddress(host)) return true;
  return host === normalizeHostName(baseDomain);
}

// Read per request at runtime (the proxy runs on Node.js), not inlined at build time.
// Same default as src/lib/env.ts, which validates the value at startup.
function platformBaseDomain(): string {
  return process.env.PLATFORM_BASE_DOMAIN?.trim() || DEFAULT_BASE_DOMAIN;
}

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

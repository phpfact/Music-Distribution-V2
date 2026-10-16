/**
 * Next.js Proxy (the file convention formerly called middleware): keeps the
 * platform console and the tenant portal on their own hosts
 * (docs/tenant-management.md §7.3, .vibe/memory/platform-host-gate.md).
 *
 * `/platform/**` answers only on the platform's own host: the base domain,
 * `localhost` or an IP address. On a tenant subdomain or custom domain it
 * does not exist (404), so a tenant's visitors never see the platform login
 * and a tenant host cannot be used to reach the console.
 *
 * The tenant portal (`/login`, `/tenant/**`, `/customer/**`) is the mirror
 * image: it answers only on tenant hosts and is a 404 on the platform host.
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
 * Description: Tell whether a path belongs to the platform console.
 * Input: The request's pathname.
 * Output: True for /platform and everything below it.
 * Use case: proxy (which host may serve the path).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function isPlatformPath(pathname: string): boolean {
  return pathname === "/platform" || pathname.startsWith("/platform/");
}

/**
 * Description: Answer with a plain 404 that reveals nothing.
 * Input: None.
 * Output: "Not found" as text/plain with nosniff.
 * Use case: proxy, for a path requested on the wrong kind of host.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function plainNotFound(): NextResponse {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
}

/**
 * Description: Keep /platform/** off tenant hosts and the tenant portal off the platform host.
 * Input: The incoming request.
 * Output: The request continues on the right kind of host; otherwise a plain 404
 *   (a tenant host can never reach the console, and the platform host never
 *   shows a tenant login or dashboard).
 * Use case: Next.js Proxy for the matcher below.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function proxy(request: NextRequest): NextResponse {
  const onPlatformHost = isPlatformHost(request.headers.get("host"), platformBaseDomain());
  const platformPath   = isPlatformPath(request.nextUrl.pathname);

  // Console paths need the platform host; portal paths need a tenant host.
  if (platformPath === onPlatformHost) return NextResponse.next();
  return plainNotFound();
}

export const config = {
  matcher: ["/platform/:path*", "/login", "/tenant/:path*", "/customer/:path*"],
};

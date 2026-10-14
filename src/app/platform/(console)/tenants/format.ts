/**
 * Display formatting for the tenant screens. Pure: the same input gives the
 * same text on the server and in the browser, whatever their time zones, so
 * dates are written in UTC and say so when they include a time.
 */

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

function parse(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "14 Oct 2026"; "—" for a value that is not a date. */
export function formatDate(iso: string): string {
  const date = parse(iso);
  return date ? DATE_FORMAT.format(date) : "—";
}

/** "14 Oct 2026, 07:03 UTC"; "—" for a value that is not a date. */
export function formatDateTime(iso: string): string {
  const date = parse(iso);
  return date ? `${DATE_FORMAT.format(date)}, ${TIME_FORMAT.format(date)} UTC` : "—";
}

/** "1,234". */
export function formatCount(value: number): string {
  return NUMBER_FORMAT.format(value);
}

// Base domains that only resolve on a developer's machine are served over plain HTTP.
function isLocalHost(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".test");
}

/**
 * The address a tenant host opens at. Tenant hosts are answered by the same
 * server as the console, so the console request's scheme (from the proxy, if
 * any) and port carry over: "acme.localhost" seen from "127.0.0.1:3000" is
 * "http://acme.localhost:3000".
 */
export function tenantSiteUrl(
  host: string,
  request: { host: string | null; forwardedProto: string | null },
): string {
  const proto = request.forwardedProto?.split(",")[0]?.trim().toLowerCase();
  const scheme = proto === "http" || proto === "https" ? proto : isLocalHost(host) ? "http" : "https";
  // "[::1]:3000" and "127.0.0.1:3000" both end in ":<port>".
  const port = request.host?.match(/:([0-9]{1,5})$/)?.[1];
  const defaultPort = scheme === "https" ? "443" : "80";
  return port && port !== defaultPort ? `${scheme}://${host}:${port}` : `${scheme}://${host}`;
}

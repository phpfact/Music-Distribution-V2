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

/**
 * Description: Parse an ISO date string.
 * Input: The ISO text.
 * Output: The Date, or null when the text is not a date.
 * Use case: formatDate and formatDateTime.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function parse(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Description: Format a date for display (UTC).
 * Input: The ISO text.
 * Output: "14 Oct 2026"; "—" for a value that is not a date.
 * Use case: Directory, details and count dialogs.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function formatDate(iso: string): string {
  const date = parse(iso);
  return date ? DATE_FORMAT.format(date) : "—";
}

/**
 * Description: Format a date and time for display (UTC, labelled).
 * Input: The ISO text.
 * Output: "14 Oct 2026, 07:03 UTC"; "—" for a value that is not a date.
 * Use case: Details page (history, domain checks, suspension).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function formatDateTime(iso: string): string {
  const date = parse(iso);
  return date ? `${DATE_FORMAT.format(date)}, ${TIME_FORMAT.format(date)} UTC` : "—";
}

/**
 * Description: Format a count with thousands separators.
 * Input: The number.
 * Output: "1,234".
 * Use case: Tenant screens.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function formatCount(value: number): string {
  return NUMBER_FORMAT.format(value);
}

/**
 * Description: Tell whether a host only resolves on a developer's machine.
 * Input: The host.
 * Output: True for localhost, *.localhost and *.test (served over plain HTTP).
 * Use case: tenantSiteUrl.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function isLocalHost(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".test");
}

/**
 * Description: Build the address a tenant host opens at.
 * Input: The tenant host and the console request's host and forwarded scheme.
 * Output: The URL with the console request's scheme and port carried over
 *   ("acme.localhost" from "127.0.0.1:3000" → "http://acme.localhost:3000").
 * Use case: The active subdomain link on the details page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function tenantSiteUrl(
  host: string,
  request: { host: string | null; forwardedProto: string | null },
): string {
  const proto  = request.forwardedProto?.split(",")[0]?.trim().toLowerCase();
  const scheme = proto === "http" || proto === "https" ? proto : isLocalHost(host) ? "http" : "https";
  // "[::1]:3000" and "127.0.0.1:3000" both end in ":<port>".
  const port        = request.host?.match(/:([0-9]{1,5})$/)?.[1];
  const defaultPort = scheme === "https" ? "443" : "80";
  return port && port !== defaultPort ? `${scheme}://${host}:${port}` : `${scheme}://${host}`;
}

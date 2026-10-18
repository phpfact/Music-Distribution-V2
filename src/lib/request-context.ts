/** Shared, bounded request metadata. Raw headers and query values never enter logs. */
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

export const REQUEST_ID_HEADER = "x-md-request-id";
export const REQUEST_PATH_HEADER = "x-md-request-path";
export const REQUEST_METHOD_HEADER = "x-md-request-method";

export type AuditRequestContext = {
  requestId: string;
  endpoint: string;
  method: string;
  clientIp: string | null;
  device: "mobile" | "tablet" | "desktop" | "unknown";
  browser: "edge" | "firefox" | "chrome" | "safari" | "unknown";
  os: "windows" | "android" | "ios" | "macos" | "linux" | "unknown";
  status?: number;
  outcome?: "success" | "failure" | "denied" | "unavailable";
};

// Paths are represented by known route words only; IDs, filenames and secrets are redacted.
const SAFE_SEGMENTS = new Set([
  "platform", "tenant", "customer", "login", "logout", "dashboard", "settings",
  "appearance", "roles", "users", "customers", "sub-customers", "tenants",
  "registrations", "registration", "signup", "modules", "new", "edit", "api",
  "health", "live", "ready", "profile-image",
]);

/**
 * Description: Keep only known route words and remove queries/private path segments.
 * Input: An untrusted pathname or endpoint.
 * Output: A bounded route label, or unknown when no absolute pathname is available.
 * Use case: Audit, authentication and host-rejection context.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export function safeEndpoint(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return "unknown";
  return value.slice(0, 1024).split(/[?#]/, 1)[0]!.split("/").slice(0, 12)
    .map((part) => part === "" || SAFE_SEGMENTS.has(part) ? part : "[redacted]").join("/");
}

/**
 * Description: Build a safe context from current request headers and optional proxy metadata.
 * Input: Headers plus a trusted proxy-owned request ID, pathname and method when available.
 * Output: Generated correlation, bounded route/method, valid last-hop IP and coarse client labels.
 * Use case: Proxy creation and current HTTP audit context; raw user-agent is never returned.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export function requestContextFromHeaders(
  headers: Pick<Headers, "get">,
  request: { requestId?: string; pathname?: string; method?: string } = {},
): AuditRequestContext {
  const candidate = request.requestId ?? headers.get(REQUEST_ID_HEADER);
  const requestId = typeof candidate === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(candidate) ? candidate : randomUUID();
  const address   = (headers.get("x-forwarded-for") ?? "").slice(-256).split(",").at(-1)?.trim() ?? "";
  const agent     = (headers.get("user-agent") ?? "").slice(0, 512);
  const method    = (request.method ?? headers.get(REQUEST_METHOD_HEADER) ?? "").slice(0, 12).toUpperCase();
  return {
    requestId,
    endpoint: safeEndpoint(request.pathname ?? headers.get(REQUEST_PATH_HEADER)),
    method: /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method) ? method : "unknown",
    clientIp: isIP(address) ? address.toLowerCase() : null,
    device: /ipad|tablet/i.test(agent) ? "tablet" : /mobile|iphone|android/i.test(agent) ? "mobile" : /windows|macintosh|linux/i.test(agent) ? "desktop" : "unknown",
    browser: /edg\//i.test(agent) ? "edge" : /firefox\//i.test(agent) ? "firefox" : /chrome\//i.test(agent) ? "chrome" : /safari\//i.test(agent) ? "safari" : "unknown",
    os: /windows/i.test(agent) ? "windows" : /android/i.test(agent) ? "android" : /iphone|ipad/i.test(agent) ? "ios" : /macintosh/i.test(agent) ? "macos" : /linux/i.test(agent) ? "linux" : "unknown",
  };
}

/**
 * Description: Revalidate an explicit context instead of trusting caller-supplied JSON.
 * Input: A context passed to the shared audit/event boundary.
 * Output: Only safe, bounded context fields; arbitrary additional properties are excluded.
 * Use case: recordAudit and structured security event writers.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export function sanitizeRequestContext(context: AuditRequestContext): AuditRequestContext {
  const safe = requestContextFromHeaders(new Headers(), {
    requestId: context.requestId,
    pathname: context.endpoint,
    method: context.method,
  });
  safe.clientIp = typeof context.clientIp === "string" && isIP(context.clientIp) ? context.clientIp : null;
  safe.device = ["mobile", "tablet", "desktop"].includes(context.device) ? context.device : "unknown";
  safe.browser = ["edge", "firefox", "chrome", "safari"].includes(context.browser) ? context.browser : "unknown";
  safe.os = ["windows", "android", "ios", "macos", "linux"].includes(context.os) ? context.os : "unknown";
  if (Number.isInteger(context.status) && context.status! >= 100 && context.status! <= 599) safe.status = context.status;
  if (context.outcome && ["success", "failure", "denied", "unavailable"].includes(context.outcome)) safe.outcome = context.outcome;
  return safe;
}

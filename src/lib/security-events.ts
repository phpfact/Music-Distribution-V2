import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { getEnv } from "./env";
import { parseHostHeader } from "./domains/rules";
import { requestContextFromHeaders, sanitizeRequestContext, type AuditRequestContext } from "./request-context";

// A domain-separated HMAC key supplies stable correlation across app replicas/restarts.
// Only the digest leaves this helper; the existing master secret is never logged.
const HOST_WINDOW_MS = 60_000;
const HOST_EVENT_BUDGET = 20;
let hostWindowStarted = 0;
let hostEventsEmitted = 0;

export type AuthenticationEvent = {
  operation: "login" | "logout";
  area: "platform" | "tenant" | "customer" | "registration" | "workspace";
  tenantId: string | null;
  outcome: "success" | "failure" | "denied" | "unavailable";
  reason: "authenticated" | "logged_out" | "invalid_credentials" | "validation" | "rate_limited" | "pending" | "suspended" | "unavailable";
  clientIp: string | null;
  /** Only a server-verified database ID, never a submitted identifier or cookie. */
  actorId?: string | null;
  /** Server-only input, converted to a keyed digest before emission. */
  submittedIdentifier?: string;
  requestContext?: AuditRequestContext | null;
};

/**
 * Description: Emit one allowlisted authentication outcome without credentials or raw identifiers.
 * Input: Fixed event fields, trusted client address, verified actor or submitted identifier, optional context.
 * Output: A structured UTC JSON event; logging failure never changes authentication behavior.
 * Use case: All platform/workspace/applicant login and logout paths.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export function recordAuthenticationEvent(event: AuthenticationEvent): void {
  try {
    const context = event.requestContext ? sanitizeRequestContext(event.requestContext) : requestContextFromHeaders(new Headers());
    const identifier = event.submittedIdentifier === undefined ? null : createHmac("sha256", getEnv().tenantSecretsKey)
      .update("music-distribution:auth-identifier:v1\0").update(`${event.tenantId ?? "platform"}:`).update(event.submittedIdentifier.slice(0, 320)).digest("hex");
    const row = {
      event: `auth.${event.operation}`, occurredAt: new Date().toISOString(),
      area: event.area, tenantId: event.tenantId, outcome: event.outcome, reason: event.reason,
      actorId: event.actorId ?? null, anonymousId: identifier,
      clientIp: event.clientIp && isIP(event.clientIp) ? event.clientIp : null,
      request: { ...context, outcome: event.outcome },
    };
    if (event.outcome === "success") console.log(JSON.stringify(row));
    else console.warn(JSON.stringify(row));
  } catch {
    // Observability cannot block sign-in or cookie/session revocation.
  }
}

/**
 * Description: Record a bounded host-rejection event without attacker-controlled map growth.
 * Input: Host, fixed reason and optional sanitized request context.
 * Output: At most twenty events per process per minute, with only normalized host/route/context.
 * Use case: Proxy wrong-host paths and resolver invalid/unknown domains.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export function recordHostRejection(
  host: string | null | undefined,
  reason: "wrong_host" | "invalid_host" | "unknown_domain",
  requestContext?: AuditRequestContext | null,
): void {
  const now = Date.now();
  if (now - hostWindowStarted >= HOST_WINDOW_MS) {
    hostWindowStarted = now;
    hostEventsEmitted = 0;
  }
  if (hostEventsEmitted >= HOST_EVENT_BUDGET) return;
  hostEventsEmitted += 1;
  const context = requestContext ? sanitizeRequestContext(requestContext) : requestContextFromHeaders(new Headers());
  try {
    console.warn(JSON.stringify({
      event: "security.host_rejected", occurredAt: new Date(now).toISOString(),
      host: host && host.length <= 300 ? parseHostHeader(host) ?? "invalid" : "invalid",
      reason, request: { ...context, status: 404, outcome: "denied" },
    }));
  } catch {
    // Keep the original generic host-gate response even when logging is unavailable.
  }
}

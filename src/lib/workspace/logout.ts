import "server-only";
import { describeError } from "@/lib/platform-auth/session";
import type { AuditRequestContext } from "@/lib/request-context";
import { recordAuthenticationEvent } from "@/lib/security-events";
import type { ReadyWorkspace } from "./context";
import { revokeRegistrationSession, revokeUserSession, validateRegistrationSession, validateUserSession } from "./sessions";

/**
 * Description: Revoke a workspace session and emit one attributed structured logout outcome.
 * Input: Ready workspace, server-selected area, cookie token and current safe request context.
 * Output: Nothing; revocation/logging errors never prevent the caller removing its cookie.
 * Use case: Tenant staff, customer and applicant logout Server Actions.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export async function revokeWorkspaceSession(
  workspace: ReadyWorkspace,
  area: "tenant" | "customer" | "registration",
  token: string,
  requestContext: AuditRequestContext | null,
): Promise<void> {
  let actorId: string | null = null;
  // Attribution is best effort: a read failure must never skip session revocation.
  try {
    actorId = area === "registration"
      ? (await validateRegistrationSession(workspace.db, workspace.tenant.id, token))?.registrationId ?? null
      : (await validateUserSession(workspace.db, workspace.tenant.id, area, token, { touch: false }))?.id ?? null;
  } catch (error) {
    console.error(`[workspace-auth] logout attribution unavailable: ${describeError(error)}`);
  }
  let outcome: "success" | "unavailable" = "success";
  try {
    if (area === "registration") await revokeRegistrationSession(workspace.db, workspace.tenant.id, token);
    else await revokeUserSession(workspace.db, workspace.tenant.id, area, token);
  } catch (error) {
    outcome = "unavailable";
    console.error(`[workspace-auth] session revocation unavailable: ${describeError(error)}`);
  }
  recordAuthenticationEvent({ operation: "logout", area, tenantId: workspace.tenant.id, actorId,
    outcome, reason: outcome === "success" ? "logged_out" : "unavailable",
    clientIp: requestContext?.clientIp ?? null, requestContext });
}

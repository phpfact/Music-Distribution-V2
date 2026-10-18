import "server-only";
/**
 * The one sign-in decision of the tenant portal (/login), for tenant staff,
 * customers and applicants (.vibe/memory/workspace-auth.md).
 *
 * A Server Action is a public HTTP endpoint, so everything is decided here on
 * the server: validation, rate limits, password checks and the destination.
 */
import { recordAuthenticationEvent, type AuthenticationEvent } from "@/lib/security-events";
import type { AuditRequestContext } from "@/lib/request-context";
import { createHash } from "node:crypto";
import { verifyAgainstDummy, verifyPassword } from "@/lib/platform-auth/password";
import { describeError } from "@/lib/platform-auth/session";
import { clearRateLimit, consumeRateLimit } from "@/lib/rate-limit";
import type { ReadyWorkspace } from "./context";
import {
  isEmailIdentifier,
  normalizeLoginIdentifier,
  textOf,
  validateLoginFields,
  type LoginFieldErrors,
} from "./rules";
import { createRegistrationSession, createUserSession } from "./sessions";

// Fixed-window limits per tenant (15 minutes).
const LOGIN_WINDOW_SECONDS     = 15 * 60;
const IDENTIFIER_ATTEMPT_LIMIT = 5;
const IP_ATTEMPT_LIMIT         = 20;

export type WorkspaceLoginResult =
  /** Signed in: the token belongs in the destination's cookie. */
  | { ok: true; destination: "tenant" | "customer" | "registration"; token: string }
  | { ok: false; reason: "validation"; fieldErrors: LoginFieldErrors }
  | { ok: false; reason: "invalid_credentials" | "pending" | "suspended" | "rate_limited" | "unavailable" };

/**
 * Description: Build the rate-limit key of a submitted identifier.
 * Input: The tenant id and the normalized identifier.
 * Output: `ws-login:<tenantId>:id:<sha256>`; hashed because people sometimes type
 *   their password into the wrong field, which must not sit in Redis in the clear.
 * Use case: authenticateWorkspaceUser (count and clear).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function identifierKey(tenantId: string, identifier: string): string {
  const digest = createHash("sha256").update(identifier).digest("hex");
  return `ws-login:${tenantId}:id:${digest}`;
}

/**
 * Description: Count one sign-in attempt against both limits.
 * Input: The tenant id, the normalized identifier and the client address.
 * Output: "allowed", "limited" (more than 5 per identifier or 20 per address in
 *   15 minutes) or "unavailable" (Redis unreachable: the sign-in is refused).
 * Use case: authenticateWorkspaceUser, before any password is checked.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
async function countAttempt(
  tenantId: string,
  identifier: string,
  clientIp: string,
): Promise<"allowed" | "limited" | "unavailable"> {
  const byIdentifier = await consumeRateLimit({
    key: identifierKey(tenantId, identifier),
    limit: IDENTIFIER_ATTEMPT_LIMIT,
    windowSeconds: LOGIN_WINDOW_SECONDS,
  });
  if (byIdentifier !== "allowed") return byIdentifier;

  return consumeRateLimit({
    key: `ws-login:${tenantId}:ip:${clientIp}`,
    limit: IP_ATTEMPT_LIMIT,
    windowSeconds: LOGIN_WINDOW_SECONDS,
  });
}

/**
 * Description: Decide a portal sign-in and start the right session.
 * Input: The ready workspace (tenant + database), the submitted identifier and
 *   password (untrusted, any type) and the client address.
 * Output: The destination area and its token, field errors, or a reason
 *   (invalid credentials, pending approval, suspended, rate limited,
 *   unavailable). Every wrong-credential path costs one Argon2 verification,
 *   and "pending"/"suspended" are only revealed after a correct password.
 * Use case: workspaceLoginAction (src/app/(workspace)/login/actions.ts).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-17
 */
export async function authenticateWorkspaceUser(
  workspace: ReadyWorkspace,
  input: { identifier: unknown; password: unknown },
  clientIp: string,
  requestContext?: AuditRequestContext | null,
): Promise<WorkspaceLoginResult> {
  const { tenant, db } = workspace;
  const identifier = normalizeLoginIdentifier(textOf(input.identifier));
  /**
   * Description: Attach tenant, pseudonymous identity and request context to this outcome.
   * Input: Fixed reason/outcome, optional verified actor ID and destination.
   * Output: One structured event; no submitted identifier is emitted in plaintext.
   * Use case: All final workspace login decisions, including applicants.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-17
   * Last modified: 2026-10-17
   */
  function report(outcome: AuthenticationEvent["outcome"], reason: AuthenticationEvent["reason"], actorId?: string, area: AuthenticationEvent["area"] = "workspace"): void {
    recordAuthenticationEvent({ operation: "login", area, tenantId: tenant.id,
      outcome, reason, actorId, submittedIdentifier: identifier, clientIp, requestContext });
  }
  /**
   * Description: Return the shared wrong-credential response and record safe correlation.
   * Input: None; reads this attempt's safe report closure.
   * Output: The same invalid-credentials response for every incorrect account/password.
   * Use case: Unknown users, wrong passwords and failed session issuance.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-17
   * Last modified: 2026-10-17
   */
  function invalidCredentials(): WorkspaceLoginResult {
    report("failure", "invalid_credentials");
    return { ok: false, reason: "invalid_credentials" };
  }
  // Used exactly as given: a password is never trimmed or otherwise altered.
  const password = textOf(input.password);

  // Step 1: required fields and lengths.
  const fieldErrors = validateLoginFields({ identifier, password });
  if (fieldErrors.identifier || fieldErrors.password) {
    report("denied", "validation");
    return { ok: false, reason: "validation", fieldErrors };
  }

  // Step 2: rate limits, counted before anything is looked up (fail closed).
  const attempt = await countAttempt(tenant.id, identifier, clientIp);
  if (attempt === "unavailable") {
    report("unavailable", "unavailable");
    return { ok: false, reason: "unavailable" };
  }
  if (attempt === "limited") {
    report("denied", "rate_limited");
    return { ok: false, reason: "rate_limited" };
  }

  try {
    // Step 3: an existing account (username or email, both unique in this tenant).
    const lookup = isEmailIdentifier(identifier) ? { email: identifier } : { username: identifier };
    const user = await db.user.findFirst({
      where: lookup,
      select: {
        id: true,
        passwordHash: true,
        status: true,
        customerId: true,
        customer: { select: { status: true, parentId: true, parent: { select: { status: true } } } },
      },
    });

    if (user) {
      // An account without a password cannot sign in; it still costs one verification.
      if (!user.passwordHash) {
        await verifyAgainstDummy(password);
        return invalidCredentials();
      }
      // Verified before the status is looked at, so a suspended account takes as long.
      if (!(await verifyPassword(user.passwordHash, password))) return invalidCredentials();

      // Step 4: the correct password — now the account's state decides.
      const isCustomer = user.customerId !== null;
      // Match session eligibility before issuing a cookie: children depend on
      // their parent customer's status as well as their own account status.
      const customer   = user.customer;
      const suspended  = user.status !== "active" || (isCustomer && (
        customer?.status !== "active" ||
        (customer.parentId !== null && customer.parent?.status !== "active")
      ));
      if (suspended) {
        report("denied", "suspended", user.id, isCustomer ? "customer" : "tenant");
        return { ok: false, reason: "suspended" };
      }

      const area  = isCustomer ? "customer" : "tenant";
      const token = await createUserSession(db, tenant.id, user.id, area, user.passwordHash);
      if (!token) return invalidCredentials();
      await clearRateLimit(identifierKey(tenant.id, identifier));
      report("success", "authenticated", user.id, area);
      return { ok: true, destination: area, token };
    }

    // Step 5: no account — maybe an open customer registration.
    const registration = await db.customerRegistration.findFirst({
      where: { ...lookup, status: { in: ["pending", "rejected"] } },
      select: { id: true, passwordHash: true, status: true },
    });
    if (!registration) {
      // No such account anywhere: spend the time a real check takes.
      await verifyAgainstDummy(password);
      return invalidCredentials();
    }
    if (!(await verifyPassword(registration.passwordHash, password))) return invalidCredentials();

    // Step 6: pending → wait; rejected → limited status page (reason + review request).
    if (registration.status === "pending") {
      report("denied", "pending", registration.id, "registration");
      return { ok: false, reason: "pending" };
    }
    const token = await createRegistrationSession(db, tenant.id, registration.id);
    report("success", "authenticated", registration.id, "registration");
    return { ok: true, destination: "registration", token };
  } catch (error) {
    report("unavailable", "unavailable");
    console.error(`[workspace-auth] tenant ${tenant.id}: login failed: ${describeError(error)}`);
    return { ok: false, reason: "unavailable" };
  }
}

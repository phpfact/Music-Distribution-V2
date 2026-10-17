import "server-only";
/**
 * Tenant-portal sessions, kept in the tenant's OWN database
 * (.vibe/memory/workspace-auth.md).
 *
 * The browser holds a random token in an area-specific cookie. The database
 * holds only SHA-256 of `<tenantId>:<scope>:<token>`, which binds every token
 * to one tenant and one scope ("tenant", "customer" or "registration"): a
 * cookie copied to another tenant's domain or to another area never matches.
 * Tokens and their hashes are never logged.
 */
import { createHash, randomBytes } from "node:crypto";
import type { TenantDb } from "@/lib/db/tenant";
import { describeError } from "@/lib/platform-auth/session";
import type { AccountType } from "./rules";

/** The two signed-in areas of the portal. */
export type SessionArea = "tenant" | "customer";
/** Everything a token can be bound to: an area, or a rejected applicant's limited session. */
type SessionScope = SessionArea | "registration";

/** A session ends this long after sign-in, however active it is. */
export const WORKSPACE_SESSION_ABSOLUTE_LIFETIME_MS = 8 * 60 * 60 * 1000;
/** A session ends when it has not been used for this long. */
export const WORKSPACE_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
/** `last_used_at` is written at most this often, not on every request. */
const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;

const TOKEN_BYTES   = 32;
// 32 random bytes in base64url: always 43 characters, no padding.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The user's single role as read with the session (role-privilege-management.md).
 * Only data: the authorization decision is made by src/lib/authz.
 */
export type WorkspaceRole = {
  id: string;
  /** The role's display name (account menu); never used for a decision. */
  name: string;
  domain: "tenant" | "customer";
  status: "active" | "disabled";
  /** "master_tenant" / "master_customer" for the master roles; null for custom roles. */
  systemKey: string | null;
  /** The main customer owning a custom customer role; null otherwise. */
  ownerCustomerId: string | null;
  /** The privilege keys stored on the role (ignored for a master role). */
  permissionKeys: string[];
};

/** The signed-in person as the portal pages see them. Never a password hash. */
export type WorkspaceUser = {
  sessionId: string;
  id: string;
  name: string;
  username: string | null;
  email: string;
  createdAt: Date;
  /** The primary account (tenant administrator / main customer's user). */
  isPrimary: boolean;
  /** The user's role, or null when none is assigned (the session stays valid). */
  role: WorkspaceRole | null;
  /** Customer area only: the customer account this user belongs to (parentId set for a sub-customer). */
  customer: { id: string; type: AccountType; name: string; parentId: string | null } | null;
};

/** A rejected (or review-requested) applicant in their limited session. */
export type WorkspaceApplicant = {
  sessionId: string;
  registrationId: string;
  fullName: string;
  accountType: AccountType;
  status: "pending" | "rejected";
  rejectionReason: string | null;
  reviewRequestedAt: Date | null;
  reviewRequestMessage: string | null;
  createdAt: Date;
};

/**
 * Description: Hash a session token for storage and lookup, bound to tenant and scope.
 * Input: The tenant id, the scope and the cookie's token.
 * Output: SHA-256 (hex) of `<tenantId>:<scope>:<token>`.
 * Use case: Every create/validate/revoke function of this module.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function hashWorkspaceToken(tenantId: string, scope: SessionScope, token: string): string {
  return createHash("sha256").update(`${tenantId}:${scope}:${token}`).digest("hex");
}

/**
 * Description: Tell whether a cookie value can be a session token at all.
 * Input: The cookie value.
 * Output: True for exactly 43 base64url characters.
 * Use case: Reject garbage without asking the database.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function isTokenShaped(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/**
 * Description: Compute the oldest last-use time a valid session may have.
 * Input: The current time.
 * Output: now minus the 30-minute idle timeout.
 * Use case: Session validation and the cleanup of stale sessions.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function idleCutoff(now: Date): Date {
  return new Date(now.getTime() - WORKSPACE_SESSION_IDLE_TIMEOUT_MS);
}

/**
 * Description: Start a signed-in session for a user whose password was just verified.
 * Input: The tenant database, the tenant id, the user id and the area.
 * Output: The token for the cookie. The user's expired or idle sessions are
 *   removed in the same transaction.
 * Use case: Workspace sign-in (tenant staff or customer).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function createUserSession(
  db: TenantDb,
  tenantId: string,
  userId: string,
  area: SessionArea,
): Promise<string> {
  const token     = randomBytes(TOKEN_BYTES).toString("base64url");
  const tokenHash = hashWorkspaceToken(tenantId, area, token);
  const now       = new Date();

  await db.$transaction(async (tx) => {
    // Step 1: housekeeping — this user's sessions that can no longer be used.
    await tx.userSession.deleteMany({
      where: {
        userId,
        OR: [{ expiresAt: { lte: now } }, { lastUsedAt: { lte: idleCutoff(now) } }],
      },
    });
    // Step 2: the new session (only its hash is stored).
    await tx.userSession.create({
      data: {
        userId,
        area,
        tokenHash,
        createdAt: now,
        lastUsedAt: now,
        expiresAt: new Date(now.getTime() + WORKSPACE_SESSION_ABSOLUTE_LIFETIME_MS),
      },
    });
  });
  return token;
}

/**
 * Description: Find the valid session (and its user) a cookie value belongs to.
 * Input: The tenant database, the tenant id, the area, the cookie's token and
 *   `touch` (default true; false for background polls, so they do not extend
 *   the idle timeout).
 * Output: The signed-in user with their role (or null role), or null. Valid
 *   means: within the absolute lifetime, used within the idle timeout, same
 *   area, user `active`; area "tenant" also needs a staff user (no customer
 *   link); area "customer" needs an active customer AND, for a sub-customer, an
 *   active main customer. The role and its privilege keys come from the same
 *   query (no extra round trip). Checked on every request, so a suspension or
 *   a role change takes effect at once. A missing or disabled role does not
 *   end the session: the authorization layer then grants nothing. The role's
 *   name is read for display only (the old owner flag is gone: every check
 *   uses privileges, .vibe/memory/role-privilege-management.md).
 * Use case: requireTenantUser / requireCustomer (src/lib/workspace/guards.ts)
 *   and the areas' privilege fingerprint (touch: false).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-16
 */
export async function validateUserSession(
  db: TenantDb,
  tenantId: string,
  area: SessionArea,
  token: string,
  options: { touch?: boolean } = {},
): Promise<WorkspaceUser | null> {
  if (!isTokenShaped(token)) return null;
  const now = new Date();

  // Step 1: the session, its user and the user's role with every condition in one query.
  const session = await db.userSession.findFirst({
    where: {
      tokenHash: hashWorkspaceToken(tenantId, area, token),
      area,
      expiresAt: { gt: now },
      lastUsedAt: { gt: idleCutoff(now) },
      user:
        area === "tenant"
          ? { status: "active", customerId: null }
          : {
              status: "active",
              customer: {
                is: {
                  status: "active",
                  // A sub-customer is refused while its main customer is suspended.
                  OR: [{ parentId: null }, { parent: { is: { status: "active" } } }],
                },
              },
            },
    },
    select: {
      id: true,
      lastUsedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          createdAt: true,
          isPrimary: true,
          customer: { select: { id: true, type: true, name: true, parentId: true } },
          roleAssignment: {
            select: {
              role: {
                select: {
                  id: true,
                  name: true,
                  domain: true,
                  status: true,
                  systemKey: true,
                  ownerCustomerId: true,
                  permissions: { select: { permission: { select: { key: true } } } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!session) return null;

  // Step 2: record use at most once a minute (keeps the idle timer honest).
  // Background polls pass touch: false, so they never keep an idle session alive.
  const touchBefore = new Date(now.getTime() - SESSION_TOUCH_INTERVAL_MS);
  if (options.touch !== false && session.lastUsedAt < touchBefore) {
    try {
      await db.userSession.updateMany({
        where: { id: session.id, lastUsedAt: { lt: touchBefore } },
        data: { lastUsedAt: now },
      });
    } catch (error) {
      // The session is valid either way; at worst it idles out a little early.
      console.error(`[workspace-auth] could not record session use: ${describeError(error)}`);
    }
  }

  // Step 3: the role as plain data (the decision itself is src/lib/authz).
  const { user } = session;
  const assigned = user.roleAssignment?.role ?? null;
  const role: WorkspaceRole | null = assigned
    ? {
        id: assigned.id,
        name: assigned.name,
        domain: assigned.domain,
        status: assigned.status,
        systemKey: assigned.systemKey,
        ownerCustomerId: assigned.ownerCustomerId,
        permissionKeys: assigned.permissions.map((link) => link.permission.key),
      }
    : null;

  // Step 4: only what the pages need.
  return {
    sessionId: session.id,
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt,
    isPrimary: user.isPrimary,
    role,
    customer: area === "customer" && user.customer ? user.customer : null,
  };
}

/**
 * Description: End the session a cookie value belongs to.
 * Input: The tenant database, the tenant id, the area and the cookie's token.
 * Output: Nothing; does nothing when there is no such session.
 * Use case: Sign-out of the tenant and customer areas.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function revokeUserSession(
  db: TenantDb,
  tenantId: string,
  area: SessionArea,
  token: string,
): Promise<void> {
  if (!isTokenShaped(token)) return;
  await db.userSession.deleteMany({ where: { tokenHash: hashWorkspaceToken(tenantId, area, token) } });
}

/**
 * Description: Start the limited session of a rejected applicant.
 * Input: The tenant database, the tenant id and the registration id.
 * Output: The token for the registration cookie. Stale sessions of the same
 *   registration are removed in the same transaction.
 * Use case: Sign-in with the password of a rejected registration.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function createRegistrationSession(
  db: TenantDb,
  tenantId: string,
  registrationId: string,
): Promise<string> {
  const token     = randomBytes(TOKEN_BYTES).toString("base64url");
  const tokenHash = hashWorkspaceToken(tenantId, "registration", token);
  const now       = new Date();

  await db.$transaction(async (tx) => {
    await tx.registrationSession.deleteMany({
      where: {
        registrationId,
        OR: [{ expiresAt: { lte: now } }, { lastUsedAt: { lte: idleCutoff(now) } }],
      },
    });
    await tx.registrationSession.create({
      data: {
        registrationId,
        tokenHash,
        createdAt: now,
        lastUsedAt: now,
        expiresAt: new Date(now.getTime() + WORKSPACE_SESSION_ABSOLUTE_LIFETIME_MS),
      },
    });
  });
  return token;
}

/**
 * Description: Find the applicant a registration cookie belongs to.
 * Input: The tenant database, the tenant id and the cookie's token.
 * Output: The applicant (registration still pending or rejected), or null. An
 *   approved registration no longer opens this page: that person signs in normally.
 * Use case: requireApplicant (the /customer/registration page and its action).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function validateRegistrationSession(
  db: TenantDb,
  tenantId: string,
  token: string,
): Promise<WorkspaceApplicant | null> {
  if (!isTokenShaped(token)) return null;
  const now = new Date();

  const session = await db.registrationSession.findFirst({
    where: {
      tokenHash: hashWorkspaceToken(tenantId, "registration", token),
      expiresAt: { gt: now },
      lastUsedAt: { gt: idleCutoff(now) },
      registration: { status: { in: ["pending", "rejected"] } },
    },
    select: {
      id: true,
      lastUsedAt: true,
      registration: {
        select: {
          id: true,
          fullName: true,
          accountType: true,
          status: true,
          rejectionReason: true,
          reviewRequestedAt: true,
          reviewRequestMessage: true,
          createdAt: true,
        },
      },
    },
  });
  if (!session) return null;

  // Record use at most once a minute.
  const touchBefore = new Date(now.getTime() - SESSION_TOUCH_INTERVAL_MS);
  if (session.lastUsedAt < touchBefore) {
    await db.registrationSession
      .updateMany({ where: { id: session.id, lastUsedAt: { lt: touchBefore } }, data: { lastUsedAt: now } })
      .catch((error: unknown) => {
        console.error(`[workspace-auth] could not record applicant session use: ${describeError(error)}`);
      });
  }

  const { registration } = session;
  return {
    sessionId: session.id,
    registrationId: registration.id,
    fullName: registration.fullName,
    accountType: registration.accountType,
    // The query above admits only these two states.
    status: registration.status === "rejected" ? "rejected" : "pending",
    rejectionReason: registration.rejectionReason,
    reviewRequestedAt: registration.reviewRequestedAt,
    reviewRequestMessage: registration.reviewRequestMessage,
    createdAt: registration.createdAt,
  };
}

/**
 * Description: End an applicant's limited session.
 * Input: The tenant database, the tenant id and the cookie's token.
 * Output: Nothing; does nothing when there is no such session.
 * Use case: "Sign out" on the registration status page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function revokeRegistrationSession(db: TenantDb, tenantId: string, token: string): Promise<void> {
  if (!isTokenShaped(token)) return;
  await db.registrationSession.deleteMany({
    where: { tokenHash: hashWorkspaceToken(tenantId, "registration", token) },
  });
}

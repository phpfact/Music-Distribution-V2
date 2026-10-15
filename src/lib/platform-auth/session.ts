import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { getControlDb } from "../db/control";
import { getEnv } from "../env";

/**
 * Platform owner sessions, kept on the server in `platform_owner_sessions`.
 *
 * The browser holds a random token in a cookie. The database holds only the
 * SHA-256 of that token, so a copy of the table cannot be used to sign in.
 * Tokens and their hashes are never logged.
 */
export const SESSION_COOKIE_NAME = "md_platform_session";
/** Scopes the cookie to the platform owner area, away from tenant and customer pages. */
export const SESSION_COOKIE_PATH = "/platform";

/** A session ends this long after sign-in, however active it is. */
export const SESSION_ABSOLUTE_LIFETIME_MS = 8 * 60 * 60 * 1000;
/** A session ends when it has not been used for this long. */
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
/** `last_used_at` is written at most this often, not on every request. */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;

const TOKEN_BYTES = 32;
// 32 random bytes in base64url: always 43 characters, no padding.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type PlatformSession = {
  sessionId: string;
  owner: { id: string; username: string };
};

/**
 * Description: Build the session cookie's options.
 * Input: None (reads NODE_ENV).
 * Output: httpOnly, Secure in production, SameSite=Lax, path /platform and an 8-hour
 *   max age. `domain` is never set: the cookie stays host-only.
 * Use case: Sign-in (set) and sign-out (delete with the same name and path).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: getEnv().nodeEnv === "production",
    sameSite: "lax",
    path: SESSION_COOKIE_PATH,
    maxAge: SESSION_ABSOLUTE_LIFETIME_MS / 1000,
  } as const;
}

/**
 * Description: Hash a session token for storage and lookup.
 * Input: The cookie's token.
 * Output: Its SHA-256 in hex; the database never holds the token itself.
 * Use case: createSession, validateSession and revokeSession.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Description: Compute the oldest last-use time a valid session may have.
 * Input: The current time.
 * Output: now minus the 30-minute idle timeout.
 * Use case: createSession (cleanup) and validateSession.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function idleCutoff(now: Date): Date {
  return new Date(now.getTime() - SESSION_IDLE_TIMEOUT_MS);
}

/**
 * Description: Start a session for an owner whose password was just verified.
 * Input: The owner id and the password hash the password was verified against.
 * Output: The token for the cookie, or null when the owner no longer exists, is not
 *   active, or has a different password hash by now (a rotation committed after
 *   the check). Expired sessions of the owner are removed in the same transaction.
 * Use case: authenticatePlatformOwner after a successful password check.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function createSession(
  ownerId: string,
  expectedPasswordHash: string,
): Promise<string | null> {
  const token     = randomBytes(TOKEN_BYTES).toString("base64url");
  const tokenHash = hashToken(token);

  const created = await getControlDb().$transaction(async (tx) => {
    // The row lock makes a concurrent password rotation wait for this
    // transaction (it then deletes the session created here), or makes this
    // read wait for the rotation and see the new hash.
    const owners = await tx.$queryRaw<{ passwordHash: string; status: string }[]>`
      SELECT "password_hash" AS "passwordHash", "status"::text AS "status"
      FROM "platform_owners"
      WHERE "id" = ${ownerId}::uuid
      FOR SHARE`;
    const owner = owners[0];
    if (!owner || owner.status !== "active" || owner.passwordHash !== expectedPasswordHash) {
      return false;
    }

    const now = new Date();
    await tx.platformOwnerSession.deleteMany({
      where: {
        ownerId,
        OR: [{ expiresAt: { lte: now } }, { lastUsedAt: { lte: idleCutoff(now) } }],
      },
    });
    await tx.platformOwnerSession.create({
      data: {
        ownerId,
        tokenHash,
        createdAt: now,
        lastUsedAt: now,
        expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_LIFETIME_MS),
      },
    });
    return true;
  });

  return created ? token : null;
}

/**
 * Description: Find the valid session a cookie value belongs to.
 * Input: The cookie's token and `touch` (false for background refreshes, so polling
 *   does not extend the idle lifetime).
 * Output: The session, or null. A session is valid while it is within its absolute
 *   lifetime, has been used within the idle timeout, and its owner is active.
 *   Never returns the password hash. Records use at most once a minute.
 * Use case: getPlatformSession and the appearance refresh action.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function validateSession(
  token: string,
  options: { touch?: boolean } = {},
): Promise<PlatformSession | null> {
  // Anything that cannot be a token is rejected without asking the database.
  if (!TOKEN_PATTERN.test(token)) return null;

  const db  = getControlDb();
  const now = new Date();
  const session = await db.platformOwnerSession.findFirst({
    where: {
      tokenHash: hashToken(token),
      expiresAt: { gt: now },
      lastUsedAt: { gt: idleCutoff(now) },
      owner: { status: "active" },
    },
    select: {
      id: true,
      lastUsedAt: true,
      owner: { select: { id: true, username: true } },
    },
  });
  if (!session) return null;

  const touchBefore = new Date(now.getTime() - SESSION_TOUCH_INTERVAL_MS);
  if (options.touch !== false && session.lastUsedAt < touchBefore) {
    try {
      await db.platformOwnerSession.updateMany({
        where: { id: session.id, lastUsedAt: { lt: touchBefore } },
        data: { lastUsedAt: now },
      });
    } catch (error) {
      // The session is valid either way; at worst it idles out a little early.
      console.error(`[platform-auth] could not record session use: ${describeError(error)}`);
    }
  }

  return { sessionId: session.id, owner: session.owner };
}

/**
 * Description: End the session a cookie value belongs to.
 * Input: The cookie's token.
 * Output: Nothing; does nothing when there is no such session.
 * Use case: Sign-out and a new sign-in in the same browser.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function revokeSession(token: string): Promise<void> {
  if (!TOKEN_PATTERN.test(token)) return;
  await getControlDb().platformOwnerSession.deleteMany({
    where: { tokenHash: hashToken(token) },
  });
}

/**
 * Description: Turn an error into one safe line for the server log.
 * Input: Any thrown value.
 * Output: The cause on one line (Prisma puts it on the last line of a multi-line
 *   message); anything that looks like a connection string is removed.
 * Use case: Every `[module] ...` error log line of the server.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lines = message
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const detail = (lines.length > 1 ? lines.at(-1) : lines[0]) ?? "unknown error";
  return detail.replace(/postgres(ql)?:\/\/\S+/gi, "<connection string>");
}

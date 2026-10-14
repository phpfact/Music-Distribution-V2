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

/** Options for the session cookie. `domain` is never set: the cookie stays host-only. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: getEnv().nodeEnv === "production",
    sameSite: "lax",
    path: SESSION_COOKIE_PATH,
    maxAge: SESSION_ABSOLUTE_LIFETIME_MS / 1000,
  } as const;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function idleCutoff(now: Date): Date {
  return new Date(now.getTime() - SESSION_IDLE_TIMEOUT_MS);
}

/**
 * Starts a session for an owner whose password has just been verified against
 * `expectedPasswordHash`, and returns the token for the cookie.
 *
 * Returns null when the owner no longer exists, is not active, or has a
 * different password hash by now (a rotation committed after the check).
 */
export async function createSession(
  ownerId: string,
  expectedPasswordHash: string,
): Promise<string | null> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
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
 * The session a cookie value belongs to, or null. A session is valid while it
 * is within its absolute lifetime, has been used within the idle timeout, and
 * its owner is active. Never returns the password hash.
 */
export async function validateSession(token: string): Promise<PlatformSession | null> {
  // Anything that cannot be a token is rejected without asking the database.
  if (!TOKEN_PATTERN.test(token)) return null;

  const db = getControlDb();
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
  if (session.lastUsedAt < touchBefore) {
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

/** Ends the session a cookie value belongs to. Does nothing if there is none. */
export async function revokeSession(token: string): Promise<void> {
  if (!TOKEN_PATTERN.test(token)) return;
  await getControlDb().platformOwnerSession.deleteMany({
    where: { tokenHash: hashToken(token) },
  });
}

/**
 * One line for the log. Prisma puts the cause on the last line of a multi-line
 * message; anything that looks like a connection string is removed.
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

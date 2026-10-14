import "server-only";
import { createHash } from "node:crypto";
import { getRedis } from "../redis";

/**
 * Limits platform owner sign-in attempts, with fixed-window counters in Redis.
 *
 * An attempt is counted before the password is checked, so a burst of
 * concurrent attempts is bounded too. The user name counter is keyed on the
 * name that was submitted, whether or not such an account exists, so the
 * limiter reveals nothing about which accounts exist.
 *
 * If Redis cannot be reached the answer is "unavailable" and the caller
 * refuses the sign-in: this fails closed.
 */
const WINDOW_SECONDS = 15 * 60;
const USERNAME_ATTEMPT_LIMIT = 5;
const IP_ATTEMPT_LIMIT = 20;

const USERNAME_KEY_PREFIX = "platform-login:user:";
const IP_KEY_PREFIX = "platform-login:ip:";

// getRedis() waits for the first connection, which stays pending while Redis
// is unreachable, so the whole exchange is bounded here.
const REDIS_TIMEOUT_MS = 2_000;

const UNKNOWN_CLIENT_IP = "unknown";
// The longest textual IPv6 address (with an embedded IPv4 part) is 45 characters.
const CLIENT_IP_MAX_LENGTH = 45;
const CLIENT_IP_PATTERN = /^[0-9a-fA-F:.]+$/;

export type LoginAttemptOutcome = "allowed" | "limited" | "unavailable";

/** Anything that does not look like an IP address shares the `unknown` bucket. */
function normalizeClientIp(value: string): string {
  const candidate = value.trim();
  if (
    !candidate ||
    candidate.length > CLIENT_IP_MAX_LENGTH ||
    !CLIENT_IP_PATTERN.test(candidate)
  ) {
    return UNKNOWN_CLIENT_IP;
  }
  return candidate.toLowerCase();
}

/**
 * The client address to rate limit on, from the `X-Forwarded-For` header.
 *
 * Assumes exactly one trusted reverse proxy in front of the app, which appends
 * the address it saw. So only the LAST entry is trusted; earlier entries are
 * whatever the client sent. Without a proxy (development) Next.js fills the
 * header in from the socket when the client sent none.
 */
export function clientIpFromForwardedFor(header: string | null): string {
  return normalizeClientIp(header?.split(",").at(-1) ?? "");
}

// Hashed: the submitted name may be long, and may be a password typed into the
// wrong field, which must not sit in Redis in the clear.
function usernameKey(normalizedUsername: string): string {
  const digest = createHash("sha256").update(normalizedUsername).digest("hex");
  return `${USERNAME_KEY_PREFIX}${digest}`;
}

async function withTimeout<T>(work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${REDIS_TIMEOUT_MS}ms`)),
          REDIS_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function reportUnavailable(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[platform-auth] rate limiter unavailable: ${message}`);
}

/**
 * Counts one sign-in attempt for the submitted user name and the client
 * address, and says whether it may proceed.
 */
export async function countLoginAttempt(
  normalizedUsername: string,
  clientIp: string,
): Promise<LoginAttemptOutcome> {
  const userKey = usernameKey(normalizedUsername);
  const ipKey = `${IP_KEY_PREFIX}${normalizeClientIp(clientIp)}`;

  try {
    const replies = await withTimeout(async () => {
      const redis = await getRedis();
      // One transaction: a counter can never be left without an expiry. NX
      // keeps the window fixed, so blocked attempts do not extend it.
      return redis
        .multi()
        .incr(userKey)
        .expire(userKey, WINDOW_SECONDS, "NX")
        .incr(ipKey)
        .expire(ipKey, WINDOW_SECONDS, "NX")
        .exec();
    });

    const userAttempts = Number(replies[0]);
    const ipAttempts = Number(replies[2]);
    if (!Number.isInteger(userAttempts) || !Number.isInteger(ipAttempts)) {
      throw new Error("unexpected reply from Redis");
    }
    return userAttempts > USERNAME_ATTEMPT_LIMIT || ipAttempts > IP_ATTEMPT_LIMIT
      ? "limited"
      : "allowed";
  } catch (error) {
    reportUnavailable(error);
    return "unavailable";
  }
}

/**
 * Forgets the attempts counted for a user name, after a successful sign-in.
 * The client address counter is kept. Never throws: the sign-in has already
 * succeeded, and the counter expires on its own.
 */
export async function clearLoginAttempts(normalizedUsername: string): Promise<void> {
  try {
    await withTimeout(async () => {
      const redis = await getRedis();
      await redis.del(usernameKey(normalizedUsername));
    });
  } catch (error) {
    reportUnavailable(error);
  }
}

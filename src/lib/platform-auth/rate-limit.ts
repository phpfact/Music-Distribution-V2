import "server-only";
import { createHash } from "node:crypto";
import { getRedis } from "../redis";
import { withTimeout } from "../with-timeout";

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
const WINDOW_SECONDS         = 15 * 60;
const USERNAME_ATTEMPT_LIMIT = 5;
const IP_ATTEMPT_LIMIT       = 20;

const USERNAME_KEY_PREFIX = "platform-login:user:";
const IP_KEY_PREFIX       = "platform-login:ip:";

// getRedis() waits for the first connection, which stays pending while Redis
// is unreachable, so the whole exchange is bounded here.
const REDIS_TIMEOUT_MS = 2_000;

const UNKNOWN_CLIENT_IP = "unknown";
// The longest textual IPv6 address (with an embedded IPv4 part) is 45 characters.
const CLIENT_IP_MAX_LENGTH = 45;
const CLIENT_IP_PATTERN    = /^[0-9a-fA-F:.]+$/;

export type LoginAttemptOutcome = "allowed" | "limited" | "unavailable";

/**
 * Description: Normalize a client address for use in a Redis key.
 * Input: The client address text.
 * Output: The trimmed, lower-cased address; anything that does not look like an IP
 *   address (empty, too long, other characters) becomes the shared `unknown` bucket.
 * Use case: countLoginAttempt and clientIpFromForwardedFor.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
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
 * Description: Read the client address to rate limit on from `X-Forwarded-For`.
 * Input: The header value (or null).
 * Output: The normalized last entry of the header. Assumes exactly one trusted
 *   reverse proxy in front of the app, which appends the address it saw: only the
 *   LAST entry is trusted; earlier entries are whatever the client sent. Without
 *   a proxy (development) Next.js fills the header in from the socket.
 * Use case: Sign-in, tenant actions and appearance actions (rate limits and audit IPs).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function clientIpFromForwardedFor(header: string | null): string {
  return normalizeClientIp(header?.split(",").at(-1) ?? "");
}

/**
 * Description: Build the Redis key of a user name's attempt counter.
 * Input: The normalized submitted user name.
 * Output: `platform-login:user:<sha256>`. Hashed: the submitted name may be long,
 *   and may be a password typed into the wrong field, which must not sit in Redis
 *   in the clear.
 * Use case: countLoginAttempt and clearLoginAttempts.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function usernameKey(normalizedUsername: string): string {
  const digest = createHash("sha256").update(normalizedUsername).digest("hex");
  return `${USERNAME_KEY_PREFIX}${digest}`;
}

/**
 * Description: Bound a Redis exchange in time.
 * Input: The work to run.
 * Output: The work's result, or a rejection after REDIS_TIMEOUT_MS (shared
 *   withTimeout helper). getRedis() waits for the first connection, which
 *   stays pending while Redis is unreachable.
 * Use case: countLoginAttempt and clearLoginAttempts (the limiter fails closed).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function withRedisTimeout<T>(work: () => Promise<T>): Promise<T> {
  return withTimeout(work, REDIS_TIMEOUT_MS, () => new Error(`timed out after ${REDIS_TIMEOUT_MS}ms`));
}

/**
 * Description: Log that the rate limiter could not be used.
 * Input: The error that occurred.
 * Output: One `[platform-auth]` error line in the server log (no user data).
 * Use case: countLoginAttempt and clearLoginAttempts.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function reportUnavailable(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[platform-auth] rate limiter unavailable: ${message}`);
}

/**
 * Description: Count one sign-in attempt and say whether it may proceed.
 * Input: The normalized submitted user name and the client address.
 * Output: "allowed", "limited" (more than 5 per name or 20 per address in 15
 *   minutes) or "unavailable" (Redis unreachable: the caller refuses the sign-in).
 * Use case: authenticatePlatformOwner, before the password is checked.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function countLoginAttempt(
  normalizedUsername: string,
  clientIp: string,
): Promise<LoginAttemptOutcome> {
  const userKey = usernameKey(normalizedUsername);
  const ipKey   = `${IP_KEY_PREFIX}${normalizeClientIp(clientIp)}`;

  try {
    const replies = await withRedisTimeout(async () => {
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
    const ipAttempts   = Number(replies[2]);
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
 * Description: Forget the attempts counted for a user name after a successful sign-in.
 * Input: The normalized user name.
 * Output: Nothing. The client address counter is kept. Never throws: the sign-in has
 *   already succeeded, and the counter expires on its own.
 * Use case: authenticatePlatformOwner.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function clearLoginAttempts(normalizedUsername: string): Promise<void> {
  try {
    await withRedisTimeout(async () => {
      const redis = await getRedis();
      await redis.del(usernameKey(normalizedUsername));
    });
  } catch (error) {
    reportUnavailable(error);
  }
}

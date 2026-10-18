import "server-only";
import { getRedis } from "./redis";
import { withTimeout } from "./with-timeout";
import { sanitizeLogMessage } from "./log-sanitizer";

/**
 * A generic fixed-window rate limiter on Redis, for actions other than the
 * platform sign-in (which has its own, see platform-auth/rate-limit.ts).
 *
 * Every call counts, including refused ones, so a burst of concurrent calls is
 * bounded too. If Redis cannot be reached the answer is "unavailable" and the
 * caller refuses the action: this fails closed.
 */
export type RateLimitOutcome = "allowed" | "limited" | "unavailable";

export type RateLimitRule = {
  /**
   * Identifies what is counted, e.g. `tenant-create:<ownerId>`. Stored in the
   * clear under the `rl:` prefix, so it must not contain secrets or anything a
   * user typed into a password field.
   */
  key: string;
  /** Calls allowed per window; the next one is "limited". */
  limit: number;
  windowSeconds: number;
};

const KEY_PREFIX = "rl:";

// getRedis() waits for the first connection, which stays pending while Redis
// is unreachable, so the whole exchange is bounded here.
const REDIS_TIMEOUT_MS = 2_000;

/**
 * Description: Bound a Redis exchange in time.
 * Input: The work to run.
 * Output: The work's result, or a rejection after REDIS_TIMEOUT_MS (shared
 *   withTimeout helper). getRedis() waits for the first connection, which stays
 *   pending while Redis is unreachable.
 * Use case: Every Redis exchange of this limiter (the limiter fails closed).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function withRedisTimeout<T>(work: () => Promise<T>): Promise<T> {
  return withTimeout(work, REDIS_TIMEOUT_MS, () => new Error(`timed out after ${REDIS_TIMEOUT_MS}ms`));
}

/**
 * Description: Reject a malformed rate-limit rule.
 * Input: The rule (key, limit, window).
 * Output: Nothing; throws RangeError for an empty key or a non-positive integer
 *   limit or window. A wrong rule is a programming error, not an outage: say so loudly.
 * Use case: consumeRateLimit, before Redis is asked.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function assertValidRule({ key, limit, windowSeconds }: RateLimitRule): void {
  if (!key) throw new RangeError("rate limit key must not be empty");
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("rate limit must be a positive integer");
  }
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new RangeError("rate limit window must be a positive number of seconds");
  }
}

/**
 * Description: Count one call against a rule and say whether it may proceed.
 * Input: The rule (key, limit per window, window length).
 * Output: "allowed", "limited" (over the limit in the current window) or
 *   "unavailable" (Redis unreachable; the caller refuses the action).
 * Use case: Tenant creation, previews, connection tests, credential and DNS actions.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function consumeRateLimit(rule: RateLimitRule): Promise<RateLimitOutcome> {
  assertValidRule(rule);
  const key = `${KEY_PREFIX}${rule.key}`;

  try {
    const replies = await withRedisTimeout(async () => {
      const redis = await getRedis();
      // One transaction: a counter can never be left without an expiry. NX
      // keeps the window fixed, so refused calls do not extend it.
      return redis.multi().incr(key).expire(key, rule.windowSeconds, "NX").exec();
    });

    const count = Number(replies[0]);
    if (!Number.isInteger(count)) throw new Error("unexpected reply from Redis");
    return count > rule.limit ? "limited" : "allowed";
  } catch (error) {
    const message = sanitizeLogMessage(error instanceof Error ? error.message : String(error));
    console.error(`[rate-limit] limiter unavailable: ${message}`);
    return "unavailable";
  }
}

/**
 * Description: Forget the calls counted for one key.
 * Input: The rule key (same text as passed to consumeRateLimit, without the prefix).
 * Output: Nothing. Never throws: the counter expires on its own anyway, so a
 *   Redis failure is only logged.
 * Use case: A successful tenant-portal sign-in clears its identifier counter,
 *   so a person who signs in and out several times is not locked out.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function clearRateLimit(key: string): Promise<void> {
  if (!key) return;
  try {
    await withRedisTimeout(async () => {
      const redis = await getRedis();
      await redis.del(`${KEY_PREFIX}${key}`);
    });
  } catch (error) {
    const message = sanitizeLogMessage(error instanceof Error ? error.message : String(error));
    console.error(`[rate-limit] could not clear a counter: ${message}`);
  }
}

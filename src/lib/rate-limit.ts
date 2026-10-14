import "server-only";
import { getRedis } from "./redis";

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

// A wrong rule is a programming error, not an outage: say so loudly.
function assertValidRule({ key, limit, windowSeconds }: RateLimitRule): void {
  if (!key) throw new RangeError("rate limit key must not be empty");
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("rate limit must be a positive integer");
  }
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new RangeError("rate limit window must be a positive number of seconds");
  }
}

/** Counts one call against the rule and says whether it may proceed. */
export async function consumeRateLimit(rule: RateLimitRule): Promise<RateLimitOutcome> {
  assertValidRule(rule);
  const key = `${KEY_PREFIX}${rule.key}`;

  try {
    const replies = await withTimeout(async () => {
      const redis = await getRedis();
      // One transaction: a counter can never be left without an expiry. NX
      // keeps the window fixed, so refused calls do not extend it.
      return redis.multi().incr(key).expire(key, rule.windowSeconds, "NX").exec();
    });

    const count = Number(replies[0]);
    if (!Number.isInteger(count)) throw new Error("unexpected reply from Redis");
    return count > rule.limit ? "limited" : "allowed";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[rate-limit] limiter unavailable: ${message}`);
    return "unavailable";
  }
}

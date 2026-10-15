/**
 * One shared time limit for asynchronous work (CLAUDE.md "Reuse, Don't
 * Duplicate"): the Redis rate limiters and the DNS checks used three copies
 * of the same race-against-a-timer code.
 */

/**
 * Description: Run asynchronous work, but give up after a fixed time.
 * Input: The work (a function returning a promise, so a synchronous throw is
 *   a rejection too), the limit in milliseconds and a factory for the error
 *   that reports the timeout.
 * Output: The work's result, or a rejection with the factory's error once the
 *   limit passes. The timer is always cleared, so it never keeps the process alive.
 * Use case: Redis exchanges (getRedis() waits while Redis is unreachable) and
 *   DNS lookups (getaddrinfo has no timeout of its own).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function withTimeout<T>(
  work: () => Promise<T>,
  timeoutMs: number,
  createTimeoutError: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  // A promise that only ever rejects, when the limit passes.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(createTimeoutError()), timeoutMs);
  });

  try {
    // Whichever settles first wins: the work's result or the timeout.
    return await Promise.race([work(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

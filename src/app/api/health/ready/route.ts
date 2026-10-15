import { pingPostgres } from "@/lib/postgres";
import { pingRedis } from "@/lib/redis";
import { withTimeout } from "@/lib/with-timeout";

// Readiness: 200 only when the app can actually reach PostgreSQL and Redis.
export const dynamic = "force-dynamic";

const CHECK_TIMEOUT_MS = 3_000;

type CheckResult = { status: "up" | "down"; latencyMs: number };

/**
 * Description: Run one dependency check with a time limit.
 * Input: The dependency name and its check.
 * Output: "up" or "down" with the latency; details go to the server log only.
 * Use case: The readiness endpoint.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-13
 * Last modified: 2026-10-15
 */
async function runCheck(name: string, check: () => Promise<void>): Promise<CheckResult> {
  const startedAt = performance.now();
  try {
    // The shared time limit: a dependency that hangs counts as down.
    await withTimeout(check, CHECK_TIMEOUT_MS, () => new Error(`timed out after ${CHECK_TIMEOUT_MS}ms`));
    return { status: "up", latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    // Detail goes to the server log only; the response says just "down".
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[health] ${name} check failed: ${message}`);
    return { status: "down", latencyMs: Math.round(performance.now() - startedAt) };
  }
}

/**
 * Description: Readiness: report whether PostgreSQL and Redis can be reached.
 * Input: None.
 * Output: 200 with "ready" only when both answer; otherwise 503 "not_ready"; never cached.
 * Use case: Container health checks and `make health`.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-13
 * Last modified: 2026-10-15
 */
export async function GET() {
  const [postgres, redis] = await Promise.all([
    runCheck("postgres", pingPostgres),
    runCheck("redis", pingRedis),
  ]);
  const ready = postgres.status === "up" && redis.status === "up";

  return Response.json(
    {
      status: ready ? "ready" : "not_ready",
      checks: { postgres, redis },
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

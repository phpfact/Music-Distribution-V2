import { pingPostgres } from "@/lib/postgres";
import { pingRedis } from "@/lib/redis";

// Readiness: 200 only when the app can actually reach PostgreSQL and Redis.
export const dynamic = "force-dynamic";

const CHECK_TIMEOUT_MS = 3_000;

type CheckResult = { status: "up" | "down"; latencyMs: number };

async function runCheck(name: string, check: () => Promise<void>): Promise<CheckResult> {
  const startedAt = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${CHECK_TIMEOUT_MS}ms`)),
          CHECK_TIMEOUT_MS,
        );
      }),
    ]);
    return { status: "up", latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    // Detail goes to the server log only; the response says just "down".
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[health] ${name} check failed: ${message}`);
    return { status: "down", latencyMs: Math.round(performance.now() - startedAt) };
  } finally {
    clearTimeout(timer);
  }
}

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

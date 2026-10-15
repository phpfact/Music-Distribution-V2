import "server-only";
import { Pool } from "pg";
import { getEnv } from "./env";

// Kept on globalThis so dev hot reloads reuse one pool instead of leaking a new one per reload.
const globalForPostgres = globalThis as typeof globalThis & { __pgPool?: Pool };

/**
 * Description: Return the shared, bounded pg connection pool.
 * Input: None.
 * Output: The pool (one per process).
 * Use case: The control-plane Prisma client and the readiness check.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-13
 * Last modified: 2026-10-15
 */
export function getPool(): Pool {
  if (!globalForPostgres.__pgPool) {
    const { postgres } = getEnv();
    const pool = new Pool({
      host: postgres.host,
      port: postgres.port,
      database: postgres.database,
      user: postgres.user,
      password: postgres.password,
      // Bounded: each app instance holds at most this many connections.
      max: postgres.poolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    // Idle clients emit "error" when the server drops them (e.g. a database
    // restart). Without a listener that would crash the process.
    pool.on("error", (error) => {
      console.error(`[postgres] idle client error: ${error.message}`);
    });
    globalForPostgres.__pgPool = pool;
  }
  return globalForPostgres.__pgPool;
}

/**
 * Description: Check that PostgreSQL answers.
 * Input: None.
 * Output: Nothing; rejects when SELECT 1 fails.
 * Use case: The readiness endpoint.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-13
 * Last modified: 2026-10-15
 */
export async function pingPostgres(): Promise<void> {
  await getPool().query("SELECT 1");
}

import "server-only";
import { EnvValidationError, getEnv } from "./env";

/**
 * Description: Validate the configuration once when the server starts.
 * Input: None.
 * Output: Nothing; logs the non-secret summary, or throws so the server refuses to
 *   start rather than failing on the first request that needs a value.
 * Use case: src/instrumentation.ts.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-13
 * Last modified: 2026-10-15
 */
export function validateStartupConfig(): void {
  try {
    const env = getEnv();
    console.log(
      `[startup] configuration OK (NODE_ENV=${env.nodeEnv}, postgres=${env.postgres.host}:${env.postgres.port}, redis=${env.redis.host}:${env.redis.port})`,
    );
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(`[startup] ${error.message}`);
    } else {
      console.error("[startup] unexpected error while validating configuration", error);
    }
    process.exit(1);
  }
}

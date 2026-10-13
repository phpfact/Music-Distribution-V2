import "server-only";
import { EnvValidationError, getEnv } from "./env";

/**
 * Runs once when the Node.js server starts (see src/instrumentation.ts).
 * Refuses to start with missing or invalid configuration rather than failing
 * later on the first request that happens to need it.
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

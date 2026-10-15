import "server-only";
/**
 * "Test connection" for attaching an existing database
 * (docs/tenant-management.md §6.4, §9.3): the same checks the create call and
 * the `check_database` step run, without saving anything.
 */
import { getEnv } from "@/lib/env";
import { describeError } from "@/lib/platform-auth/session";
import { checkExistingDatabase, type DatabaseCheck } from "@/lib/provisioning";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  parsePort,
  validateDatabaseIdentifier,
  validateExistingDatabasePassword,
} from "@/lib/tenants/rules";
import { type TenantActor, UNAVAILABLE_MESSAGE } from "./common";

export type ConnectionTestInput = {
  databaseName: string;
  databaseUser: string;
  databasePassword: string;
  databasePort: string;
};

export type ConnectionTestField = keyof ConnectionTestInput;

export type ConnectionTestResult =
  /** The checks ran; `ok` is false when at least one failed (warnings do not count). */
  | { kind: "checked"; ok: boolean; checks: DatabaseCheck[] }
  /** The input itself is invalid; nothing was sent to PostgreSQL. */
  | { kind: "invalid"; fieldErrors: Partial<Record<ConnectionTestField, string>> }
  | { kind: "error"; reason: "rate_limited" | "unavailable"; message: string };

const TEST_LIMIT = { limit: 10, windowSeconds: 5 * 60 };

/**
 * Description: Run the existing-database checks without saving anything (Test connection).
 * Input: The typed database name, user, password and port, and the acting owner.
 * Output: The check list ("checked"), field errors ("invalid": nothing was sent to
 *   PostgreSQL), or a rate-limit/unavailable message. Input is validated before
 *   the limiter (10 tests per 5 minutes), so typos do not use up attempts.
 * Use case: The create form's Test connection button (Manual database, existing database).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function testDatabaseConnection(
  input: ConnectionTestInput,
  actor: TenantActor,
): Promise<ConnectionTestResult> {
  const { postgres } = getEnv();
  const reservedNames = [postgres.database, postgres.user];
  const name          = validateDatabaseIdentifier(input.databaseName, "database", { reservedNames });
  const user          = validateDatabaseIdentifier(input.databaseUser, "user", { reservedNames });
  const password      = validateExistingDatabasePassword(input.databasePassword);
  const port          = parsePort(input.databasePort, postgres.port);

  // Validated before the limiter, so typos do not use up the owner's attempts.
  const fieldErrors: Partial<Record<ConnectionTestField, string>> = {};
  if (!name.ok) fieldErrors.databaseName = name.error;
  if (!user.ok) fieldErrors.databaseUser = user.error;
  if (!password.ok) fieldErrors.databasePassword = password.error;
  if (!port.ok) fieldErrors.databasePort = port.error;
  if (!name.ok || !user.ok || !password.ok || !port.ok) return { kind: "invalid", fieldErrors };

  const limit = await consumeRateLimit({ key: `tenant-db-test:${actor.ownerId}`, ...TEST_LIMIT });
  if (limit === "limited") {
    return {
      kind: "error",
      reason: "rate_limited",
      message: "Too many connection tests in a short time. Wait a few minutes, then try again.",
    };
  }
  if (limit === "unavailable") {
    return { kind: "error", reason: "unavailable", message: UNAVAILABLE_MESSAGE };
  }

  try {
    const outcome = await checkExistingDatabase({
      database: name.value,
      user: user.value,
      password: password.value,
      port: port.value,
    });
    return { kind: "checked", ok: outcome.ok, checks: outcome.checks };
  } catch (error) {
    console.error(`[tenants] connection test failed: ${describeError(error)}`);
    return { kind: "error", reason: "unavailable", message: UNAVAILABLE_MESSAGE };
  }
}

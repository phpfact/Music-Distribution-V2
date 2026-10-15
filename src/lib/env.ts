import "server-only";
import path from "node:path";

/**
 * Server-side runtime configuration.
 *
 * Everything here is read from the process environment at runtime (never at
 * build time) and must never be imported from client components. None of these
 * variables may be given a NEXT_PUBLIC_ prefix.
 */
export type Env = {
  nodeEnv: "development" | "production" | "test";
  postgres: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    poolMax: number;
    tenantPoolMax: number;
    tenantClientsMax: number;
  };
  redis: {
    host: string;
    port: number;
    password: string;
  };
  /**
   * Master secret for the tenant secret store (src/lib/secrets). The AES key is
   * derived from it. Losing it makes every stored tenant database password
   * unrecoverable. Never logged.
   */
  tenantSecretsKey: string;
  /** Lower-case host name; each tenant gets `<label>.<platformBaseDomain>`. */
  platformBaseDomain: string;
  /** Absolute directory that holds uploaded files (src/lib/storage). */
  storageRoot: string;
};

const PLACEHOLDER_PREFIX           = "change-me";
const MIN_PRODUCTION_SECRET_LENGTH = 16;

const DEFAULT_PLATFORM_BASE_DOMAIN = "localhost";
// A basic host name check only; the full domain rules live in
// src/lib/domains/rules.ts, which is client-safe and kept separate from env.
const HOSTNAME_LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const HOSTNAME_MAX_LENGTH    = 253;

export class EnvValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(
      [
        "Invalid environment configuration:",
        ...problems.map((problem) => `  - ${problem}`),
        "Set these in your .env file (see .env.example) or in the container environment, then restart.",
      ].join("\n"),
    );
    this.name = "EnvValidationError";
  }
}

/**
 * Description: Validate the environment into typed configuration.
 * Input: The environment variables (process.env, or a test object).
 * Output: The configuration; throws EnvValidationError listing every problem at
 *   once (variable names only, never values, so it is safe to log).
 * Use case: getEnv and tests.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-13
 * Last modified: 2026-10-15
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  // Problems name the variable only. Values are never included, so this is safe to log.
  const problems: string[] = [];
  const isProduction = source.NODE_ENV === "production";

  /**
   * Description: Read a required variable.
   * Input: The variable name.
   * Output: The trimmed value; records a problem and returns "" when missing.
   * Use case: parseEnv.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-13
   * Last modified: 2026-10-15
   */
  const required = (name: string): string => {
    const value = source[name]?.trim();
    if (!value) {
      problems.push(`${name} is required but is not set`);
      return "";
    }
    return value;
  };

  /**
   * Description: Read a required secret and check it is production-ready.
   * Input: The variable name.
   * Output: The value; in production records a problem for a placeholder or a too-short secret.
   * Use case: parseEnv.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-13
   * Last modified: 2026-10-15
   */
  const secret = (name: string): string => {
    const value = required(name);
    if (value && isProduction) {
      if (value.startsWith(PLACEHOLDER_PREFIX)) {
        problems.push(`${name} still has its placeholder value; set a real secret for production`);
      } else if (value.length < MIN_PRODUCTION_SECRET_LENGTH) {
        problems.push(
          `${name} must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`,
        );
      }
    }
    return value;
  };

  /**
   * Description: Read an optional integer within bounds.
   * Input: The variable name, the default and the allowed range.
   * Output: The integer, or the default when unset; records a problem when out of range.
   * Use case: parseEnv.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-13
   * Last modified: 2026-10-15
   */
  const integer = (name: string, fallback: number, min: number, max: number): number => {
    const raw = source[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      problems.push(`${name} must be an integer between ${min} and ${max}`);
      return fallback;
    }
    return value;
  };

  /**
   * Description: Read an optional host name.
   * Input: The variable name and the default.
   * Output: The host name; records a problem for an invalid one.
   * Use case: parseEnv.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-13
   * Last modified: 2026-10-15
   */
  const hostname = (name: string, fallback: string): string => {
    const value  = source[name]?.trim() || fallback;
    const labels = value.split(".");
    const valid =
      value.length <= HOSTNAME_MAX_LENGTH &&
      labels.every((label) => HOSTNAME_LABEL_PATTERN.test(label)) &&
      // A numeric last label would make it an IP address, which cannot have subdomains.
      !/^[0-9]+$/.test(labels.at(-1) ?? "");
    if (!valid) {
      problems.push(
        `${name} must be a lower-case host name such as "example.com" (no scheme, port, path or trailing dot)`,
      );
      return fallback;
    }
    return value;
  };

  /**
   * Description: Read an optional absolute directory path.
   * Input: The variable name and the default.
   * Output: The path; records a problem for a relative one (it would depend on the
   *   working directory the server is started from).
   * Use case: parseEnv.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-13
   * Last modified: 2026-10-15
   */
  const absolutePath = (name: string, fallback: string): string => {
    const value = source[name]?.trim();
    if (!value) return fallback;
    if (!path.isAbsolute(value)) {
      problems.push(`${name} must be an absolute path`);
      return fallback;
    }
    return path.resolve(value);
  };

  const nodeEnv = source.NODE_ENV;
  if (nodeEnv !== "development" && nodeEnv !== "production" && nodeEnv !== "test") {
    problems.push("NODE_ENV must be one of: development, production, test");
  }

  const env: Env = {
    nodeEnv: nodeEnv === "production" || nodeEnv === "test" ? nodeEnv : "development",
    postgres: {
      host: required("POSTGRES_HOST"),
      port: integer("POSTGRES_PORT", 5432, 1, 65535),
      database: required("POSTGRES_DB"),
      user: required("POSTGRES_USER"),
      password: secret("POSTGRES_PASSWORD"),
      poolMax: integer("POSTGRES_POOL_MAX", 10, 1, 100),
      tenantPoolMax: integer("POSTGRES_TENANT_POOL_MAX", 3, 1, 20),
      tenantClientsMax: integer("POSTGRES_TENANT_CLIENTS_MAX", 50, 1, 1000),
    },
    redis: {
      host: required("REDIS_HOST"),
      port: integer("REDIS_PORT", 6379, 1, 65535),
      password: secret("REDIS_PASSWORD"),
    },
    tenantSecretsKey: secret("TENANT_SECRETS_KEY"),
    platformBaseDomain: hostname("PLATFORM_BASE_DOMAIN", DEFAULT_PLATFORM_BASE_DOMAIN),
    // The default is /app/storage in the containers (the working directory is /app).
    storageRoot: absolutePath("STORAGE_ROOT", path.resolve("storage")),
  };

  if (problems.length > 0) {
    throw new EnvValidationError(problems);
  }
  return env;
}

let cached: Env | undefined;

/**
 * Description: Return the validated configuration (parsed once).
 * Input: None.
 * Output: The configuration; throws EnvValidationError listing every problem.
 * Use case: The whole server side.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-13
 * Last modified: 2026-10-15
 */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

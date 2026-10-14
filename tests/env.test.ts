/** src/lib/env.ts: the tenant-management settings. */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "@/lib/env";

const SECRETS_KEY = "vt-tenant-secrets-key-0123456789abcdef";

/** A complete, valid environment; tests override single variables. */
function source(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    POSTGRES_HOST: "postgres",
    POSTGRES_DB: "vt_db",
    POSTGRES_USER: "vt_user",
    POSTGRES_PASSWORD: "vt-postgres-password-0123456789",
    REDIS_HOST: "redis",
    REDIS_PASSWORD: "vt-redis-password-0123456789",
    TENANT_SECRETS_KEY: SECRETS_KEY,
    ...overrides,
  };
}

/** The problems reported for an invalid environment. */
function problemsOf(env: NodeJS.ProcessEnv): string[] {
  try {
    parseEnv(env);
  } catch (error) {
    if (error instanceof EnvValidationError) return error.problems;
    throw error;
  }
  throw new Error("expected the environment to be rejected");
}

describe("TENANT_SECRETS_KEY", () => {
  it("is read as given", () => {
    expect(parseEnv(source()).tenantSecretsKey).toBe(SECRETS_KEY);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["white space", "   "],
  ])("is required (%s)", (_description, value) => {
    expect(problemsOf(source({ TENANT_SECRETS_KEY: value }))).toStrictEqual([
      "TENANT_SECRETS_KEY is required but is not set",
    ]);
  });

  it("may keep its placeholder outside production", () => {
    const env = parseEnv(source({ TENANT_SECRETS_KEY: "change-me-tenant-secrets-key" }));
    expect(env.tenantSecretsKey).toBe("change-me-tenant-secrets-key");
  });

  it.each([
    ["the placeholder", "change-me-tenant-secrets-key"],
    ["a short value", "short-key"],
  ])("rejects %s in production, without echoing it", (_description, value) => {
    const problems = problemsOf(source({ NODE_ENV: "production", TENANT_SECRETS_KEY: value }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^TENANT_SECRETS_KEY /);
    expect(problems.join("\n")).not.toContain(value);
  });
});

describe("PLATFORM_BASE_DOMAIN", () => {
  it("defaults to localhost", () => {
    expect(parseEnv(source()).platformBaseDomain).toBe("localhost");
    expect(parseEnv(source({ PLATFORM_BASE_DOMAIN: "  " })).platformBaseDomain).toBe("localhost");
  });

  it.each(["example.com", "app.example.co.uk", "dev.localhost", "x1-y.example"])(
    "accepts %s",
    (value) => {
      expect(parseEnv(source({ PLATFORM_BASE_DOMAIN: value })).platformBaseDomain).toBe(value);
    },
  );

  it("trims surrounding white space", () => {
    const env = parseEnv(source({ PLATFORM_BASE_DOMAIN: " example.com " }));
    expect(env.platformBaseDomain).toBe("example.com");
  });

  it.each([
    ["upper case", "Example.com"],
    ["a scheme", "https://example.com"],
    ["a port", "example.com:3000"],
    ["a path", "example.com/app"],
    ["a trailing dot", "example.com."],
    ["an empty label", "example..com"],
    ["a leading hyphen", "-example.com"],
    ["a label over 63 characters", `${"a".repeat(64)}.com`],
    ["an IPv4 address", "192.0.2.1"],
    ["an underscore", "my_app.example.com"],
  ])("rejects a value with %s", (_description, value) => {
    expect(problemsOf(source({ PLATFORM_BASE_DOMAIN: value }))).toStrictEqual([
      'PLATFORM_BASE_DOMAIN must be a lower-case host name such as "example.com" (no scheme, port, path or trailing dot)',
    ]);
  });
});

describe("STORAGE_ROOT", () => {
  it("defaults to storage/ under the working directory", () => {
    expect(parseEnv(source()).storageRoot).toBe(path.resolve("storage"));
    expect(path.isAbsolute(parseEnv(source()).storageRoot)).toBe(true);
  });

  it("accepts an absolute path and normalizes it", () => {
    expect(parseEnv(source({ STORAGE_ROOT: "/srv/files/" })).storageRoot).toBe("/srv/files");
    expect(parseEnv(source({ STORAGE_ROOT: "/srv/a/../files" })).storageRoot).toBe("/srv/files");
  });

  it.each(["storage", "./storage", "../storage"])("rejects the relative path %s", (value) => {
    expect(problemsOf(source({ STORAGE_ROOT: value }))).toStrictEqual([
      "STORAGE_ROOT must be an absolute path",
    ]);
  });
});

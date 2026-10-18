import { describe, expect, it } from "vitest";
import { MAX_LOG_MESSAGE_LENGTH, sanitizeLogMessage } from "@/lib/log-sanitizer";
import { describeError } from "@/lib/platform-auth/session";
import { describeForLog, redact } from "@/lib/provisioning/errors";

describe("AUD-019 shared error credential boundary", () => {
  it.each([
    "password=AUDIT_CANARY", "token=AUDIT_CANARY", "secret=AUDIT_CANARY",
    '"password": "AUDIT_CANARY"', '"accessToken":"AUDIT_CANARY"',
    "refresh_token=AUDIT_CANARY", "databasePassword='AUDIT_CANARY'",
    "x-api-key: AUDIT_CANARY", "Authorization: Bearer AUDIT_CANARY",
    "Cookie: session=AUDIT_CANARY; mode=dark", "Bearer AUDIT_CANARY",
    "postgresql://user:AUDIT_CANARY@database/app", "redis://:AUDIT_CANARY@redis/0",
    "SCRAM-SHA-256$AUDIT_CANARY", "$argon2id$AUDIT_CANARY",
    "ALTER ROLE app PASSWORD 'AUDIT_CANARY'", "PASSWORD 'one''AUDIT_CANARY'",
    "PASSWORD E'prefix\\nAUDIT_CANARY'", "PASSWORD $tag$AUDIT_CANARY$tag$",
    'password="first line\nAUDIT_CANARY"',
    "postgresql://user:prefix'AUDIT_CANARY@host/app",
    "redis://user:prefix'AUDIT_CANARY@host/0",
    "PASSWORD 'AUDIT_CANARY",
  ])("removes recognized secret form %s through both existing exports", (text) => {
    expect(describeError(new Error(text))).not.toContain("AUDIT_CANARY");
    expect(redact(text)).not.toContain("AUDIT_CANARY");
  });

  it("keeps benign diagnostics, Prisma last-line behavior and provisioning causes", () => {
    expect(describeError(new Error("Prisma invocation\n\n  connection refused  "))).toBe("connection refused");
    expect(describeError("")).toBe("unknown error");
    const error = Object.assign(new Error("database unavailable", { cause: new Error("connection refused") }), { code: "ECONNREFUSED" });
    expect(describeForLog(error)).toBe("[ECONNREFUSED] database unavailable <- caused by: connection refused");
  });

  it("redacts known values before bounding and removes injected line controls", () => {
    expect(sanitizeLogMessage("long-secret/secret", ["secret", "long-secret"])).toBe("<redacted>/<redacted>");
    expect(describeError(new Error("failure\rFAKE_EVENT\u0000"))).toBe("failure FAKE_EVENT");
    const output = sanitizeLogMessage(`token=${"a".repeat(10_000)} ${"b".repeat(10_000)}`);
    expect(output).toHaveLength(MAX_LOG_MESSAGE_LENGTH);
    expect(output.startsWith("token=<redacted>")).toBe(true);
  });

  it("handles malformed SQL escapes without synchronous exponential backtracking", () => {
    const started = performance.now();
    expect(describeError(new Error(`PASSWORD '${"\\".repeat(20_000)}`))).toBe("PASSWORD '<redacted>'");
    expect(performance.now() - started).toBeLessThan(250);
  });
});

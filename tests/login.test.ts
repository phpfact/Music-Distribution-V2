/**
 * authenticatePlatformOwner (src/lib/platform-auth/login.ts): the whole
 * sign-in decision, against the scratch database and the real Redis.
 */
import { randomBytes } from "node:crypto";
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getControlDb, type ControlDb } from "@/lib/db/control";
import { authenticatePlatformOwner, type LoginResult } from "@/lib/platform-auth/login";
import { hashPassword } from "@/lib/platform-auth/password";
import { validateSession } from "@/lib/platform-auth/session";
import { getRedis } from "@/lib/redis";
import { closeAppDatabase, closeAppRedis } from "./support/app-connections";
import { captureConsole } from "./support/console";
import { LoginKeys } from "./support/login-keys";
import {
  clearPlatformTables,
  connectToTestDatabase,
  insertOwner,
  listSessions,
} from "./support/postgres";

// The real clients, unless a test replaces one call to simulate an outage.
vi.mock("@/lib/redis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/redis")>();
  return { ...actual, getRedis: vi.fn(actual.getRedis) };
});
vi.mock("@/lib/db/control", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/control")>();
  return { ...actual, getControlDb: vi.fn(actual.getControlDb) };
});

const INVALID_CREDENTIALS = { ok: false, reason: "invalid_credentials" } as const;
const RATE_LIMITED = { ok: false, reason: "rate_limited" } as const;
const UNAVAILABLE = { ok: false, reason: "unavailable" } as const;

const PASSWORD = `vt-${randomBytes(15).toString("base64url")}`;
const WRONG_PASSWORD = `vt-${randomBytes(15).toString("base64url")}`;

let db: Client;
let keys: LoginKeys;
let passwordHash: string;
let nextIpSuffix = 1;
let logged: ReturnType<typeof captureConsole>;

beforeAll(async () => {
  db = await connectToTestDatabase();
  keys = await LoginKeys.open();
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await clearPlatformTables(db);
  // Every test runs with the console recorded (and quiet).
  logged = captureConsole();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(getRedis).mockReset();
  vi.mocked(getControlDb).mockReset();
  await keys.cleanup();
});

afterAll(async () => {
  await clearPlatformTables(db);
  await db.end();
  await keys.close();
  await closeAppRedis();
  await closeAppDatabase();
});

/** A user name no other test uses, with its counter key registered for cleanup. */
async function newUsername(): Promise<string> {
  const username = `vt-login-${randomBytes(6).toString("hex")}`;
  await keys.claimUsername(username);
  return username;
}

async function newOwner(status: "active" | "disabled" = "active") {
  const username = await newUsername();
  const id = await insertOwner(db, { username, passwordHash, status });
  return { id, username };
}

/** A documentation address of this test's own, registered for cleanup. */
async function newIp(): Promise<string> {
  const ip = `203.0.113.${nextIpSuffix}`;
  nextIpSuffix += 1;
  await keys.claimIp(ip);
  return ip;
}

function signIn(username: unknown, password: unknown, ip: string): Promise<LoginResult> {
  return authenticatePlatformOwner({ username, password }, ip);
}

async function expectToken(result: LoginResult): Promise<string> {
  if (!result.ok) throw new Error(`expected a successful sign-in, got "${result.reason}"`);
  expect(Object.keys(result).sort()).toStrictEqual(["ok", "token"]);
  expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return result.token;
}

describe("[R5] valid credentials", () => {
  it("returns a token that validates as a session of that owner", async () => {
    const owner = await newOwner();

    const token = await expectToken(await signIn(owner.username, PASSWORD, await newIp()));

    expect(await validateSession(token)).toMatchObject({
      owner: { id: owner.id, username: owner.username },
    });
    expect(await listSessions(db, owner.id)).toHaveLength(1);
  });

  it("matches the username case-insensitively and trimmed", async () => {
    const owner = await newOwner();

    const result = await signIn(`  ${owner.username.toUpperCase()} `, PASSWORD, await newIp());

    const token = await expectToken(result);
    expect((await validateSession(token))?.owner.username).toBe(owner.username);
  });

  it("does not trim the password: a trailing or leading space makes it wrong", async () => {
    const owner = await newOwner();
    const ip = await newIp();

    expect(await signIn(owner.username, `${PASSWORD} `, ip)).toStrictEqual(INVALID_CREDENTIALS);
    expect(await signIn(owner.username, ` ${PASSWORD}`, ip)).toStrictEqual(INVALID_CREDENTIALS);
    expect(await listSessions(db)).toHaveLength(0);
  });

  it("signs in with a password that itself ends in a space", async () => {
    const spaced = `${PASSWORD} `;
    const username = await newUsername();
    await insertOwner(db, { username, passwordHash: await hashPassword(spaced) });
    const ip = await newIp();

    expect(await signIn(username, PASSWORD, ip)).toStrictEqual(INVALID_CREDENTIALS);
    await expectToken(await signIn(username, spaced, ip));
  });

  it("gives 3 simultaneous correct sign-ins 3 distinct tokens, all valid", async () => {
    const owner = await newOwner();
    const ip = await newIp();

    const results = await Promise.all([1, 2, 3].map(() => signIn(owner.username, PASSWORD, ip)));

    const tokens = await Promise.all(results.map(expectToken));
    expect(new Set(tokens).size).toBe(3);
    for (const token of tokens) {
      expect((await validateSession(token))?.owner.id).toBe(owner.id);
    }
    expect(await listSessions(db, owner.id)).toHaveLength(3);
  });
});

describe("[R6] invalid credentials", () => {
  it("rejects a wrong password", async () => {
    const owner = await newOwner();

    const result = await signIn(owner.username, WRONG_PASSWORD, await newIp());

    expect(result).toStrictEqual(INVALID_CREDENTIALS);
    expect(await listSessions(db)).toHaveLength(0);
  });

  it("rejects an unknown username exactly like a wrong password", async () => {
    await newOwner();

    const result = await signIn(await newUsername(), PASSWORD, await newIp());

    expect(result).toStrictEqual(INVALID_CREDENTIALS);
    expect(await listSessions(db)).toHaveLength(0);
  });

  it.each([
    ["a space inside", "vt-bad name"],
    ["a forbidden character", "vt-bad!name"],
    ["a trailing separator", "vt-bad-name-"],
    ["more than 64 characters", `vt-${"a".repeat(80)}`],
    ["an SQL fragment", "vt-' OR '1'='1"],
  ])("rejects a malformed username (%s) exactly like a wrong password", async (_name, username) => {
    await newOwner();
    await keys.claimUsername(username);

    const result = await signIn(username, PASSWORD, await newIp());

    expect(result).toStrictEqual(INVALID_CREDENTIALS);
    expect(await listSessions(db)).toHaveLength(0);
  });

  it("rejects a 257-character password exactly like a wrong password", async () => {
    const owner = await newOwner();

    const result = await signIn(owner.username, "p".repeat(257), await newIp());

    expect(result).toStrictEqual(INVALID_CREDENTIALS);
    expect(await listSessions(db)).toHaveLength(0);
  });

  it("rejects a disabled account with the correct password, exactly like a wrong password", async () => {
    const owner = await newOwner("disabled");

    const result = await signIn(owner.username, PASSWORD, await newIp());

    expect(result).toStrictEqual(INVALID_CREDENTIALS);
    expect(await listSessions(db)).toHaveLength(0);
  });

  it("rejects an account whose stored hash is not a valid hash", async () => {
    const username = await newUsername();
    await insertOwner(db, { username, passwordHash: PASSWORD });

    const result = await signIn(username, PASSWORD, await newIp());

    expect(result).toStrictEqual(INVALID_CREDENTIALS);
    expect(await listSessions(db)).toHaveLength(0);
  });
});

describe("[R7] empty input", () => {
  const USERNAME_MESSAGE = "Enter your username.";
  const PASSWORD_MESSAGE = "Enter your password.";

  it.each<[string, unknown, unknown, { username?: string; password?: string }]>([
    ["an empty username", "", PASSWORD, { username: USERNAME_MESSAGE }],
    ["a username of only white space", "   ", PASSWORD, { username: USERNAME_MESSAGE }],
    ["an empty password", "vt-login-someone", "", { password: PASSWORD_MESSAGE }],
    ["both empty", "", "", { username: USERNAME_MESSAGE, password: PASSWORD_MESSAGE }],
    ["null values", null, null, { username: USERNAME_MESSAGE, password: PASSWORD_MESSAGE }],
    ["undefined values", undefined, undefined, { username: USERNAME_MESSAGE, password: PASSWORD_MESSAGE }],
    ["numbers", 12345, 67890, { username: USERNAME_MESSAGE, password: PASSWORD_MESSAGE }],
    ["objects", { toString: () => "vt-login-someone" }, ["x"], { username: USERNAME_MESSAGE, password: PASSWORD_MESSAGE }],
    ["a non-string username", 12345, PASSWORD, { username: USERNAME_MESSAGE }],
    ["a non-string password", "vt-login-someone", { length: 20 }, { password: PASSWORD_MESSAGE }],
  ])("reports %s as a validation error and counts no attempt", async (_name, username, password, fieldErrors) => {
    const ip = await newIp();
    const usernameKey = await keys.claimUsername("vt-login-someone");
    const emptyUsernameKey = LoginKeys.usernameKey("");
    const emptyBefore = await keys.count(emptyUsernameKey);
    vi.mocked(getRedis).mockClear();
    vi.mocked(getControlDb).mockClear();

    const result = await signIn(username, password, ip);

    expect(result).toStrictEqual({ ok: false, reason: "validation", fieldErrors });
    // Neither the limiter nor the database was asked.
    expect(getRedis).not.toHaveBeenCalled();
    expect(getControlDb).not.toHaveBeenCalled();
    expect(await keys.count(LoginKeys.ipKey(ip))).toBeNull();
    expect(await keys.count(usernameKey)).toBeNull();
    expect(await keys.count(emptyUsernameKey)).toBe(emptyBefore);
  });

  it("accepts a password of only white space as a password (and finds it wrong)", async () => {
    const owner = await newOwner();

    expect(await signIn(owner.username, "   ", await newIp())).toStrictEqual(INVALID_CREDENTIALS);
  });
});

describe("brute force protection", () => {
  it("refuses the 6th attempt after 5 failures, even with the correct password", async () => {
    const owner = await newOwner();
    const ip = await newIp();

    for (let i = 0; i < 5; i += 1) {
      expect(await signIn(owner.username, WRONG_PASSWORD, ip)).toStrictEqual(INVALID_CREDENTIALS);
    }

    expect(await signIn(owner.username, PASSWORD, ip)).toStrictEqual(RATE_LIMITED);
    // Also from another address, and for any spelling of the name.
    expect(await signIn(owner.username.toUpperCase(), PASSWORD, await newIp())).toStrictEqual(
      RATE_LIMITED,
    );
    expect(await listSessions(db)).toHaveLength(0);
  });

  it("does not touch the database or the hash while a username is blocked", async () => {
    const owner = await newOwner();
    const ip = await newIp();
    for (let i = 0; i < 5; i += 1) await signIn(owner.username, WRONG_PASSWORD, ip);
    vi.mocked(getControlDb).mockClear();

    expect(await signIn(owner.username, PASSWORD, ip)).toStrictEqual(RATE_LIMITED);

    expect(getControlDb).not.toHaveBeenCalled();
  });

  it("resets the username counter on a successful sign-in", async () => {
    const owner = await newOwner();
    const ip = await newIp();

    for (let i = 0; i < 4; i += 1) {
      expect(await signIn(owner.username, WRONG_PASSWORD, ip)).toStrictEqual(INVALID_CREDENTIALS);
    }
    await expectToken(await signIn(owner.username, PASSWORD, ip));
    expect(await keys.count(LoginKeys.usernameKey(owner.username))).toBeNull();

    for (let i = 0; i < 5; i += 1) {
      expect(await signIn(owner.username, WRONG_PASSWORD, ip)).toStrictEqual(INVALID_CREDENTIALS);
    }
    expect(await signIn(owner.username, WRONG_PASSWORD, ip)).toStrictEqual(RATE_LIMITED);
    // The address counter was not reset: 4 + 1 + 5 + 1 attempts.
    expect(await keys.count(LoginKeys.ipKey(ip))).toBe(11);
  });

  it("lets at most 5 of 12 simultaneous wrong-password attempts reach the password check", async () => {
    const owner = await newOwner();
    const ip = await newIp();

    const results = await Promise.all(
      Array.from({ length: 12 }, () => signIn(owner.username, WRONG_PASSWORD, ip)),
    );

    const reasons = results.map((result) => (result.ok ? "ok" : result.reason));
    expect(reasons.filter((reason) => reason === "invalid_credentials")).toHaveLength(5);
    expect(reasons.filter((reason) => reason === "rate_limited")).toHaveLength(7);
    expect(await listSessions(db)).toHaveLength(0);
  });

  it("limits a username that exists and one that does not identically", async () => {
    const existing = (await newOwner()).username;
    const missing = await newUsername();

    const outcomes: Record<string, LoginResult[]> = { existing: [], missing: [] };
    const existingIp = await newIp();
    const missingIp = await newIp();
    for (let i = 0; i < 6; i += 1) {
      outcomes.existing?.push(await signIn(existing, WRONG_PASSWORD, existingIp));
      outcomes.missing?.push(await signIn(missing, WRONG_PASSWORD, missingIp));
    }

    const expected = [...Array<LoginResult>(5).fill(INVALID_CREDENTIALS), RATE_LIMITED];
    expect(outcomes.existing).toStrictEqual(expected);
    expect(outcomes.missing).toStrictEqual(expected);
    expect(await keys.count(LoginKeys.usernameKey(existing))).toBe(6);
    expect(await keys.count(LoginKeys.usernameKey(missing))).toBe(6);
  });

  it("refuses the correct password once an address has made more than 20 attempts", async () => {
    const owner = await newOwner();
    const ip = await newIp();
    // 20 attempts spread over usernames that do not exist, 5 each.
    for (let name = 0; name < 4; name += 1) {
      const username = await newUsername();
      for (let i = 0; i < 5; i += 1) {
        expect(await signIn(username, WRONG_PASSWORD, ip)).toStrictEqual(INVALID_CREDENTIALS);
      }
    }

    expect(await signIn(owner.username, PASSWORD, ip)).toStrictEqual(RATE_LIMITED);
    // The account itself is not blocked: another address still gets in.
    await expectToken(await signIn(owner.username, PASSWORD, await newIp()));
  });
});

describe("when a dependency is down", () => {
  it.each([
    ["fails", () => Promise.reject(new Error("connect ECONNREFUSED"))],
    ["never answers", () => new Promise<never>(() => undefined)],
  ])("refuses the sign-in when Redis %s, without checking the password", async (_name, outage) => {
    const owner = await newOwner();
    const ip = await newIp();
    vi.mocked(getControlDb).mockClear();
    vi.mocked(getRedis).mockImplementationOnce(outage);

    const result = await signIn(owner.username, PASSWORD, ip);

    expect(result).toStrictEqual(UNAVAILABLE);
    expect(getControlDb).not.toHaveBeenCalled();
    expect(await listSessions(db)).toHaveLength(0);
  });

  it.each([
    [
      "a multi-line Prisma error",
      [
        "",
        "Invalid `prisma.platformOwner.findUnique()` invocation:",
        "",
        "  where: { username: ... } at postgresql://user:s3cret-db-pass@host/db",
        "",
        "Can't reach database server at postgresql://user:s3cret-db-pass@host/db",
      ].join("\n"),
    ],
    ["a one-line driver error", "connection to postgresql://user:s3cret-db-pass@host/db refused"],
    ["a postgres:// URL", "could not connect: postgres://user:s3cret-db-pass@host:5432/db"],
  ])("[R13] reveals nothing when the database fails with %s", async (_name, message) => {
    const owner = await newOwner();
    const ip = await newIp();
    const failure = new Error(message);
    const brokenDb = {
      platformOwner: { findUnique: () => Promise.reject(failure) },
    } as unknown as ControlDb;
    vi.mocked(getControlDb).mockImplementationOnce(() => brokenDb);

    const result = await signIn(owner.username, PASSWORD, ip);

    expect(result).toStrictEqual(UNAVAILABLE);
    expect(JSON.stringify(result)).not.toContain("s3cret");
    const text = logged.text();
    expect(text).toContain("[platform-auth] login failed");
    expect(text).not.toContain("s3cret-db-pass");
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toMatch(/postgres(ql)?:\/\//i);
    expect(await listSessions(db)).toHaveLength(0);
  });

  it("[R13] reveals nothing when the database fails while the session is created", async () => {
    const owner = await newOwner();
    const ip = await newIp();
    const failure = new Error(
      "Transaction failed\npassword authentication failed at postgresql://user:s3cret-db-pass@host/db",
    );
    // The first use (looking the owner up) works; the second (the session) fails.
    const real = getControlDb();
    const brokenDb = { $transaction: () => Promise.reject(failure) } as unknown as ControlDb;
    vi.mocked(getControlDb)
      .mockImplementationOnce(() => real)
      .mockImplementationOnce(() => brokenDb);

    const result = await signIn(owner.username, PASSWORD, ip);

    expect(result).toStrictEqual(UNAVAILABLE);
    const text = logged.text();
    expect(text).not.toContain("s3cret-db-pass");
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toMatch(/postgres(ql)?:\/\//i);
    expect(await listSessions(db)).toHaveLength(0);
  });
});

describe("what is logged", () => {
  it("logs neither the password nor the username of a failed attempt", async () => {
    const owner = await newOwner();
    const unknown = await newUsername();
    const ip = await newIp();

    await signIn(owner.username, WRONG_PASSWORD, ip);
    await signIn(unknown, WRONG_PASSWORD, ip);
    // A password typed into the username field.
    await keys.claimUsername(`vt-${WRONG_PASSWORD}`);
    await signIn(`vt-${WRONG_PASSWORD}`, WRONG_PASSWORD, ip);

    const text = logged.text();
    expect(text).toContain("login rejected");
    expect(text).not.toContain(WRONG_PASSWORD);
    expect(text.toLowerCase()).not.toContain(WRONG_PASSWORD.toLowerCase());
    expect(text).not.toContain(owner.username);
    expect(text).not.toContain(unknown);
  });

  it("logs neither the password nor the username of a rate-limited attempt", async () => {
    const owner = await newOwner();
    const ip = await newIp();
    for (let i = 0; i < 5; i += 1) await signIn(owner.username, WRONG_PASSWORD, ip);
    // Only what the blocked attempt itself logs.
    logged = captureConsole();

    expect(await signIn(owner.username, PASSWORD, ip)).toStrictEqual(RATE_LIMITED);

    const text = logged.text();
    expect(text).toContain("rate limited");
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(owner.username);
  });

  it("logs neither the password nor the token of a successful sign-in", async () => {
    const owner = await newOwner();

    const token = await expectToken(await signIn(owner.username, PASSWORD, await newIp()));

    const text = logged.text();
    expect(text).toContain("login succeeded");
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(token);
    expect(text).not.toContain(passwordHash);
  });
});

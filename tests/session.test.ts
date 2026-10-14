/** src/lib/platform-auth/session.ts against the scratch database. */
import { randomBytes, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSession,
  revokeSession,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  validateSession,
} from "@/lib/platform-auth/session";
import { closeAppDatabase } from "./support/app-connections";
import {
  clearPlatformTables,
  connectToTestDatabase,
  findSession,
  insertOwner,
  insertSession,
  listSessions,
  sha256Hex,
} from "./support/postgres";

// Sessions never verify a password, so no real hash is needed here.
const STORED_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo";

let db: Client;

beforeAll(async () => {
  db = await connectToTestDatabase();
});

beforeEach(async () => {
  await clearPlatformTables(db);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await clearPlatformTables(db);
  await db.end();
  await closeAppDatabase();
});

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

async function newOwner(status: "active" | "disabled" = "active") {
  const username = `vt-session-${randomBytes(4).toString("hex")}`;
  const id = await insertOwner(db, { username, passwordHash: STORED_HASH, status });
  return { id, username };
}

/** A session row for a token the test knows, with the given age. */
async function sessionWithToken(
  ownerId: string,
  age: { lastUsedMinutesAgo?: number; expiresInMinutes?: number } = {},
) {
  const token = newToken();
  const row = await insertSession(db, { ownerId, tokenHash: sha256Hex(token), ...age });
  return { token, row };
}

async function startSession(ownerId: string): Promise<string> {
  const token = await createSession(ownerId, STORED_HASH);
  if (!token) throw new Error("the session was not created");
  return token;
}

describe("createSession", () => {
  it("returns a 43-character base64url token and stores only its SHA-256", async () => {
    const owner = await newOwner();

    const token = await startSession(owner.id);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const sessions = await listSessions(db);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.token_hash).toBe(sha256Hex(token));
    expect(sessions[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sessions[0]?.owner_id).toBe(owner.id);

    // The token is in no column of either table.
    const dump = await db.query<{ text: string }>(
      `SELECT row_to_json(s)::text AS text FROM platform_owner_sessions s
       UNION ALL SELECT row_to_json(o)::text FROM platform_owners o`,
    );
    expect(dump.rows).toHaveLength(2);
    for (const row of dump.rows) expect(row.text).not.toContain(token);
  });

  it("gives the session 8 hours and marks it as just used", async () => {
    const owner = await newOwner();

    const token = await startSession(owner.id);

    const session = await findSession(db, sha256Hex(token));
    if (!session) throw new Error("no session row");
    const lifetime = session.expires_at.getTime() - session.created_at.getTime();
    expect(lifetime).toBe(8 * 60 * 60 * 1000);
    expect(session.last_used_at.getTime()).toBe(session.created_at.getTime());
    expect(Math.abs(Date.now() - session.created_at.getTime())).toBeLessThan(10_000);
  });

  it("returns a different token for every session", async () => {
    const owner = await newOwner();

    const tokens = await Promise.all([1, 2, 3, 4].map(() => startSession(owner.id)));

    expect(new Set(tokens).size).toBe(4);
    expect(await listSessions(db, owner.id)).toHaveLength(4);
  });

  it("returns null, and stores nothing, when the owner is disabled", async () => {
    const owner = await newOwner("disabled");

    expect(await createSession(owner.id, STORED_HASH)).toBeNull();
    expect(await listSessions(db)).toHaveLength(0);
  });

  it("returns null, and stores nothing, when the owner does not exist", async () => {
    expect(await createSession(randomUUID(), STORED_HASH)).toBeNull();
    expect(await listSessions(db)).toHaveLength(0);
  });

  it("returns null, and stores nothing, when the stored hash is no longer the verified one", async () => {
    const owner = await newOwner();

    expect(await createSession(owner.id, `${STORED_HASH}x`)).toBeNull();
    expect(await listSessions(db)).toHaveLength(0);
  });

  it("removes that owner's expired and idle sessions, and keeps the live ones", async () => {
    const owner = await newOwner();
    const other = await newOwner();
    const live = await sessionWithToken(owner.id, { lastUsedMinutesAgo: 5 });
    const expired = await sessionWithToken(owner.id, { expiresInMinutes: -1 });
    const idle = await sessionWithToken(owner.id, { lastUsedMinutesAgo: 31 });
    const otherExpired = await sessionWithToken(other.id, { expiresInMinutes: -1 });

    const token = await startSession(owner.id);

    const remaining = (await listSessions(db)).map((session) => session.token_hash);
    expect(remaining).toContain(live.row.token_hash);
    expect(remaining).toContain(sha256Hex(token));
    expect(remaining).not.toContain(expired.row.token_hash);
    expect(remaining).not.toContain(idle.row.token_hash);
    // Another owner's rows are not this sign-in's business.
    expect(remaining).toContain(otherExpired.row.token_hash);
    expect(remaining).toHaveLength(3);
  });
});

describe("validateSession", () => {
  it("returns the session id and the owner's id and username, and nothing else", async () => {
    const owner = await newOwner();
    const token = await startSession(owner.id);
    const row = await findSession(db, sha256Hex(token));

    const session = await validateSession(token);

    expect(session).toStrictEqual({
      sessionId: row?.id,
      owner: { id: owner.id, username: owner.username },
    });
    const serialized = JSON.stringify(session);
    expect(serialized).not.toContain("argon2");
    expect(serialized).not.toContain(STORED_HASH);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(sha256Hex(token));
  });

  it.each([
    ["an empty string", ""],
    ["garbage", "garbage"],
    ["42 characters", "a".repeat(42)],
    ["44 characters", "a".repeat(44)],
    ["a very long value", "a".repeat(10_000)],
    ["a character outside base64url", `${"a".repeat(42)}+`],
    ["a padded base64 value", `${"a".repeat(42)}=`],
    ["a token with a trailing newline", `${"a".repeat(43)}\n`],
    ["an SQL fragment", "' OR 1=1 --"],
  ])("returns null for %s", async (_description, token) => {
    const owner = await newOwner();
    await startSession(owner.id);

    expect(await validateSession(token)).toBeNull();
  });

  it("returns null for a well-formed token that was never issued", async () => {
    const owner = await newOwner();
    await startSession(owner.id);

    expect(await validateSession(newToken())).toBeNull();
  });

  it("does not accept the stored hash in place of the token", async () => {
    const owner = await newOwner();
    const token = await startSession(owner.id);

    expect(await validateSession(sha256Hex(token))).toBeNull();
    expect(await validateSession(sha256Hex(token).slice(0, 43))).toBeNull();
  });

  it("[R12] returns null once expires_at has passed, however recently it was used", async () => {
    const owner = await newOwner();
    const { token } = await sessionWithToken(owner.id, { expiresInMinutes: -1 });

    expect(await validateSession(token)).toBeNull();
  });

  it("[R12] returns null after more than 30 minutes without use", async () => {
    const owner = await newOwner();
    const { token } = await sessionWithToken(owner.id, { lastUsedMinutesAgo: 31 });

    expect(await validateSession(token)).toBeNull();
  });

  it("is still valid after 29 minutes without use", async () => {
    const owner = await newOwner();
    const { token } = await sessionWithToken(owner.id, { lastUsedMinutesAgo: 29 });

    expect(await validateSession(token)).not.toBeNull();
  });

  it("refreshes last_used_at when it is older than the touch interval", async () => {
    const owner = await newOwner();
    const { token, row } = await sessionWithToken(owner.id, { lastUsedMinutesAgo: 5 });

    expect(await validateSession(token)).not.toBeNull();

    const after = await findSession(db, row.token_hash);
    if (!after) throw new Error("no session row");
    expect(after.last_used_at.getTime()).toBeGreaterThan(row.last_used_at.getTime());
    expect(Math.abs(Date.now() - after.last_used_at.getTime())).toBeLessThan(10_000);
    // Using a session never extends its absolute lifetime.
    expect(after.expires_at.getTime()).toBe(row.expires_at.getTime());
  });

  it("does not rewrite last_used_at when it was used within the touch interval", async () => {
    const owner = await newOwner();
    const { token, row } = await sessionWithToken(owner.id, { lastUsedMinutesAgo: 0.25 });

    expect(await validateSession(token)).not.toBeNull();
    expect(await validateSession(token)).not.toBeNull();

    const after = await findSession(db, row.token_hash);
    expect(after?.last_used_at.getTime()).toBe(row.last_used_at.getTime());
  });

  it("returns null for an existing session once its owner is disabled", async () => {
    const owner = await newOwner();
    const token = await startSession(owner.id);
    expect(await validateSession(token)).not.toBeNull();

    await db.query("UPDATE platform_owners SET status = 'disabled' WHERE id = $1", [owner.id]);

    expect(await validateSession(token)).toBeNull();
  });
});

describe("[R11] revokeSession", () => {
  it("ends the session: the token is no longer valid and its row is gone", async () => {
    const owner = await newOwner();
    const token = await startSession(owner.id);
    const other = await startSession(owner.id);

    await revokeSession(token);

    expect(await validateSession(token)).toBeNull();
    expect(await findSession(db, sha256Hex(token))).toBeUndefined();
    // Only that one session.
    expect(await validateSession(other)).not.toBeNull();
  });

  it("is idempotent, and ignores values that cannot be a token", async () => {
    const owner = await newOwner();
    const token = await startSession(owner.id);
    const other = await startSession(owner.id);

    await revokeSession(token);
    await expect(revokeSession(token)).resolves.toBeUndefined();
    await expect(revokeSession(newToken())).resolves.toBeUndefined();
    await expect(revokeSession("")).resolves.toBeUndefined();
    await expect(revokeSession("garbage")).resolves.toBeUndefined();

    expect(await listSessions(db, owner.id)).toHaveLength(1);
    expect(await validateSession(other)).not.toBeNull();
  });
});

describe("sessionCookieOptions", () => {
  it("names the cookie md_platform_session", () => {
    expect(SESSION_COOKIE_NAME).toBe("md_platform_session");
  });

  it("is HttpOnly, SameSite=Lax, scoped to /platform, 8 hours, host-only; not Secure under NODE_ENV=test", () => {
    const options = sessionCookieOptions();

    expect(options).toStrictEqual({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/platform",
      maxAge: 28_800,
    });
    expect(options).not.toHaveProperty("domain");
  });

  it("is Secure when the module is loaded with NODE_ENV=production", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    // Production validation wants real-looking secrets of 16 characters or more.
    vi.stubEnv("POSTGRES_PASSWORD", "vt-production-postgres-secret");
    vi.stubEnv("REDIS_PASSWORD", "vt-production-redis-secret");
    try {
      const production = await import("@/lib/platform-auth/session");
      const options = production.sessionCookieOptions();

      expect(options.secure).toBe(true);
      expect(options).toStrictEqual({
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/platform",
        maxAge: 28_800,
      });
      expect(options).not.toHaveProperty("domain");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
    expect(process.env.NODE_ENV).toBe("test");
  });
});

/**
 * The control-plane migrations, as applied to the scratch database by
 * tests/support/global-setup.ts with `prisma migrate deploy`.
 */
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearPlatformTables,
  connectToTestDatabase,
  insertOwner,
  insertSession,
  listSessions,
  sha256Hex,
} from "./support/postgres";
import { childEnv, postgresEnv, runProcess } from "./support/process";

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

// Not a real hash: these tests never verify a password.
const PLACEHOLDER_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo";

let db: Client;

beforeAll(async () => {
  db = await connectToTestDatabase();
});

beforeEach(async () => {
  await clearPlatformTables(db);
});

afterAll(async () => {
  await clearPlatformTables(db);
  await db.end();
});

type Column = { column_name: string; data_type: string; is_nullable: string; length: number | null };

async function columnsOf(table: string): Promise<Record<string, Omit<Column, "column_name">>> {
  const result = await db.query<Column>(
    `SELECT column_name, data_type, is_nullable, character_maximum_length AS length
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return Object.fromEntries(
    result.rows.map(({ column_name, ...rest }) => [column_name, rest] as const),
  );
}

describe("[R1] the migration creates the platform owner schema", () => {
  it("creates platform_owners with the expected columns", async () => {
    expect(await columnsOf("platform_owners")).toStrictEqual({
      id: { data_type: "uuid", is_nullable: "NO", length: null },
      username: { data_type: "character varying", is_nullable: "NO", length: 64 },
      password_hash: { data_type: "character varying", is_nullable: "NO", length: 255 },
      status: { data_type: "USER-DEFINED", is_nullable: "NO", length: null },
      created_at: { data_type: "timestamp with time zone", is_nullable: "NO", length: null },
      updated_at: { data_type: "timestamp with time zone", is_nullable: "NO", length: null },
    });
  });

  it("creates platform_owner_sessions with the expected columns", async () => {
    expect(await columnsOf("platform_owner_sessions")).toStrictEqual({
      id: { data_type: "uuid", is_nullable: "NO", length: null },
      owner_id: { data_type: "uuid", is_nullable: "NO", length: null },
      token_hash: { data_type: "character", is_nullable: "NO", length: 64 },
      created_at: { data_type: "timestamp with time zone", is_nullable: "NO", length: null },
      last_used_at: { data_type: "timestamp with time zone", is_nullable: "NO", length: null },
      expires_at: { data_type: "timestamp with time zone", is_nullable: "NO", length: null },
    });
  });

  it("has no column that could hold a plaintext password or a session token", async () => {
    const names = [
      ...Object.keys(await columnsOf("platform_owners")),
      ...Object.keys(await columnsOf("platform_owner_sessions")),
    ];
    expect(names.filter((name) => /^(password|token|secret)$/.test(name))).toStrictEqual([]);
  });

  it("defines the owner status as active or disabled, active by default", async () => {
    const labels = await db.query<{ label: string }>(
      `SELECT e.enumlabel AS label
       FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'platform_owner_status'
       ORDER BY e.enumsortorder`,
    );
    expect(labels.rows.map((row) => row.label)).toStrictEqual(["active", "disabled"]);

    await db.query("INSERT INTO platform_owners (id, username, password_hash) VALUES ($1, $2, $3)", [
      randomUUID(),
      "vt-default-status",
      PLACEHOLDER_HASH,
    ]);
    const stored = await db.query<{ status: string }>("SELECT status FROM platform_owners");
    expect(stored.rows).toStrictEqual([{ status: "active" }]);
  });

  it("has a unique index on platform_owners.username", async () => {
    const indexes = await db.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'platform_owners'",
    );
    expect(
      indexes.rows.some((row) => /CREATE UNIQUE INDEX .*\(username\)/.test(row.indexdef)),
    ).toBe(true);
  });

  it("rejects a second owner with the same username (unique violation)", async () => {
    await insertOwner(db, { username: "vt-duplicate", passwordHash: PLACEHOLDER_HASH });
    await expect(
      insertOwner(db, { username: "vt-duplicate", passwordHash: PLACEHOLDER_HASH }),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it.each([
    ["an upper-case letter", "Owner"],
    ["fewer than 3 characters", "ab"],
    ["a space", "a b"],
    ["a leading separator", "-abc"],
    ["a trailing separator", "abc."],
    ["an empty string", ""],
  ])("rejects a username with %s (check constraint)", async (_description, username) => {
    await expect(
      insertOwner(db, { username, passwordHash: PLACEHOLDER_HASH }),
    ).rejects.toMatchObject({
      code: CHECK_VIOLATION,
      constraint: "platform_owners_username_format_check",
    });
  });

  it("accepts a normalized username", async () => {
    await insertOwner(db, { username: "vt-owner.one_2", passwordHash: PLACEHOLDER_HASH });
    await insertOwner(db, { username: "abc", passwordHash: PLACEHOLDER_HASH });
  });

  it("rejects a second session with the same token_hash (unique violation)", async () => {
    const ownerId = await insertOwner(db, { username: "vt-sessions", passwordHash: PLACEHOLDER_HASH });
    const tokenHash = sha256Hex("vt-duplicate-token");
    await insertSession(db, { ownerId, tokenHash });
    await expect(insertSession(db, { ownerId, tokenHash })).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
    });
  });

  it("rejects a session for an owner that does not exist (foreign key)", async () => {
    await expect(insertSession(db, { ownerId: randomUUID() })).rejects.toMatchObject({
      code: "23503",
    });
  });

  it("deletes an owner's sessions with the owner (cascade), and only those", async () => {
    const removed = await insertOwner(db, { username: "vt-removed", passwordHash: PLACEHOLDER_HASH });
    const kept = await insertOwner(db, { username: "vt-kept", passwordHash: PLACEHOLDER_HASH });
    await insertSession(db, { ownerId: removed });
    await insertSession(db, { ownerId: removed });
    const keptSession = await insertSession(db, { ownerId: kept });

    await db.query("DELETE FROM platform_owners WHERE id = $1", [removed]);

    expect((await listSessions(db)).map((session) => session.id)).toStrictEqual([keptSession.id]);
  });

  it(
    "leaves nothing pending: `prisma migrate status` reports the schema up to date",
    { timeout: 60_000 },
    async () => {
      const status = await runProcess(
        "node_modules/.bin/prisma",
        ["migrate", "status", "--config", "prisma/control.config.ts"],
        childEnv(postgresEnv(process.env.PLATFORM_TEST_DATABASE ?? "")),
      );
      expect(status.code, status.stderr).toBe(0);
      expect(status.stdout).toContain("Database schema is up to date");
    },
  );
});

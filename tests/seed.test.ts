/**
 * prisma/seed.ts, run the way `npm run db:seed` runs it: as a child process
 * under tsx, with an explicit environment, against the scratch database.
 */
import { randomBytes } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyPassword } from "@/lib/platform-auth/password";
import {
  clearPlatformTables,
  connectToTestDatabase,
  insertSession,
  listOwners,
  listSessions,
  type OwnerRow,
} from "./support/postgres";
import { childEnv, postgresEnv, runProcess, type ProcessResult } from "./support/process";

// Each run starts tsx and hashes a password; some tests make three runs.
vi.setConfig({ testTimeout: 60_000 });

const USERNAME_VARIABLE = "PLATFORM_OWNER_INITIAL_USERNAME";
const PASSWORD_VARIABLE = "PLATFORM_OWNER_INITIAL_PASSWORD";

const testDatabase = process.env.PLATFORM_TEST_DATABASE ?? "";

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

function newPassword(): string {
  return `pw-${randomBytes(15).toString("base64url")}`;
}

type SeedOptions = {
  username?: string;
  password?: string;
  args?: string[];
  /** Replaces or adds variables, e.g. to point the seed at a closed port. */
  env?: Record<string, string>;
};

/**
 * Runs the seed. Whatever the outcome, the configured password must appear in
 * neither output stream; that is asserted here, so for every run of this file.
 */
async function runSeed(options: SeedOptions): Promise<ProcessResult> {
  const variables: Record<string, string> = { ...postgresEnv(testDatabase), ...options.env };
  if (options.username !== undefined) variables[USERNAME_VARIABLE] = options.username;
  if (options.password !== undefined) variables[PASSWORD_VARIABLE] = options.password;

  const result = await runProcess(
    "node_modules/.bin/tsx",
    ["prisma/seed.ts", ...(options.args ?? [])],
    childEnv(variables),
  );

  if (options.password) {
    expect(result.stdout.includes(options.password), "stdout contains the password").toBe(false);
    expect(result.stderr.includes(options.password), "stderr contains the password").toBe(false);
  }
  return result;
}

async function onlyOwner(): Promise<OwnerRow> {
  const owners = await listOwners(db);
  expect(owners).toHaveLength(1);
  const owner = owners[0];
  if (!owner) throw new Error("no owner row");
  return owner;
}

describe("[R2][R4] the seed creates the default platform owner", () => {
  it("creates exactly one active owner whose password is stored as an Argon2id hash", async () => {
    const password = newPassword();
    const result = await runSeed({ username: "vt-seed-owner", password });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('created platform owner "vt-seed-owner"');

    const owner = await onlyOwner();
    expect(owner.username).toBe("vt-seed-owner");
    expect(owner.status).toBe("active");
    expect(owner.password_hash.startsWith("$argon2id$")).toBe(true);
    expect(owner.password_hash).not.toBe(password);
    expect(owner.password_hash).not.toContain(password);
    expect(await verifyPassword(owner.password_hash, password)).toBe(true);
    expect(await verifyPassword(owner.password_hash, `${password}x`)).toBe(false);
    expect(await listSessions(db)).toHaveLength(0);
  });

  it("makes the bootstrapped owner the primary account holding Master Platform", async () => {
    const result = await runSeed({ username: "vt-seed-owner", password: newPassword() });
    expect(result.code, result.stderr).toBe(0);

    const role = await db.query<{ is_primary: boolean; system_key: string | null; name: string }>(
      `SELECT o.is_primary, r.system_key, r.name
       FROM platform_owners o JOIN platform_roles r ON r.id = o.role_id`,
    );
    expect(role.rows).toStrictEqual([{ is_primary: true, system_key: "master_platform", name: "Master Platform" }]);
  });

  it("stores the username normalized (trimmed, lower case)", async () => {
    const result = await runSeed({ username: "  Test-Owner ", password: newPassword() });

    expect(result.code, result.stderr).toBe(0);
    expect((await onlyOwner()).username).toBe("test-owner");
  });

  it("uses the password exactly as given: surrounding spaces are part of it", async () => {
    const password = `  ${newPassword()} `;
    const result = await runSeed({ username: "vt-seed-owner", password });

    expect(result.code, result.stderr).toBe(0);
    const owner = await onlyOwner();
    expect(await verifyPassword(owner.password_hash, password)).toBe(true);
    expect(await verifyPassword(owner.password_hash, password.trim())).toBe(false);
  });
});

describe("[R3] seeding again creates no duplicate", () => {
  it("changes nothing on a second run with the same configuration, and says so", async () => {
    const password = newPassword();
    expect((await runSeed({ username: "vt-seed-owner", password })).code).toBe(0);
    const before = await onlyOwner();

    const second = await runSeed({ username: "vt-seed-owner", password });

    expect(second.code, second.stderr).toBe(0);
    expect(second.stdout).toContain("already exists; it was not recreated or modified");
    expect(second.stdout).not.toContain("created platform owner");
    const after = await onlyOwner();
    expect(after.id).toBe(before.id);
    expect(after.password_hash).toBe(before.password_hash);
    expect(after.updated_at.getTime()).toBe(before.updated_at.getTime());
  });

  it("changes nothing on a second run with a different username and password", async () => {
    const password = newPassword();
    expect((await runSeed({ username: "vt-seed-owner", password })).code).toBe(0);
    const before = await onlyOwner();

    const otherPassword = newPassword();
    const second = await runSeed({ username: "vt-seed-other", password: otherPassword });

    expect(second.code, second.stderr).toBe(0);
    expect(second.stdout).toContain("already exists; it was not recreated or modified");
    const after = await onlyOwner();
    expect(after).toStrictEqual(before);
    expect(await verifyPassword(after.password_hash, password)).toBe(true);
    expect(await verifyPassword(after.password_hash, otherPassword)).toBe(false);
  });

  it("creates one owner when two seeds start at the same time", async () => {
    const password = newPassword();
    const [first, second] = await Promise.all([
      runSeed({ username: "vt-seed-owner", password }),
      runSeed({ username: "vt-seed-owner", password }),
    ]);

    expect(first.code, first.stderr).toBe(0);
    expect(second.code, second.stderr).toBe(0);
    const created = [first, second].filter((run) => run.stdout.includes("created platform owner"));
    expect(created).toHaveLength(1);
    const owner = await onlyOwner();
    expect(await verifyPassword(owner.password_hash, password)).toBe(true);
  });
});

describe("the seed refuses an invalid configuration and creates nothing", () => {
  it.each([
    {
      name: "the username is missing",
      options: { password: newPassword() },
      named: [USERNAME_VARIABLE],
    },
    {
      name: "the password is missing",
      options: { username: "vt-seed-owner" },
      named: [PASSWORD_VARIABLE],
    },
    {
      name: "both are missing",
      options: {},
      named: [USERNAME_VARIABLE, PASSWORD_VARIABLE],
    },
    {
      name: "both are empty",
      options: { username: "", password: "" },
      named: [USERNAME_VARIABLE, PASSWORD_VARIABLE],
    },
    {
      name: "the username is only white space",
      options: { username: "   ", password: newPassword() },
      named: [USERNAME_VARIABLE],
    },
    {
      name: "the password is still a placeholder",
      options: { username: "vt-seed-owner", password: "change-me-before-first-use" },
      named: [PASSWORD_VARIABLE],
    },
    {
      name: "the password has 11 characters",
      options: { username: "vt-seed-owner", password: "Kq7#vTz2!mW" },
      named: [PASSWORD_VARIABLE],
    },
    {
      name: "the password has 257 characters",
      options: { username: "vt-seed-owner", password: "Zq9".repeat(85) + "!7" },
      named: [PASSWORD_VARIABLE],
    },
    {
      name: "the username has a forbidden character",
      options: { username: "vt seed owner", password: newPassword() },
      named: [USERNAME_VARIABLE],
    },
    {
      name: "the username is too short",
      options: { username: "ab", password: newPassword() },
      named: [USERNAME_VARIABLE],
    },
    {
      name: "the username starts with a separator",
      options: { username: "-vt-seed-owner", password: newPassword() },
      named: [USERNAME_VARIABLE],
    },
    {
      name: "the username has 65 characters",
      options: { username: "v".repeat(65), password: newPassword() },
      named: [USERNAME_VARIABLE],
    },
  ])("exits 1 when $name", async ({ options, named }) => {
    const result = await runSeed(options);

    expect(result.code).toBe(1);
    for (const variable of named) expect(result.stderr).toContain(variable);
    expect(result.stderr).toContain("Nothing was changed");
    expect(await listOwners(db)).toHaveLength(0);
  });

  it("accepts the boundary lengths: a 12-character password and a 3-character username", async () => {
    const password = "Kq7#vTz2!mW4";
    const result = await runSeed({ username: "vt3", password });

    expect(result.code, result.stderr).toBe(0);
    const owner = await onlyOwner();
    expect(owner.username).toBe("vt3");
    expect(await verifyPassword(owner.password_hash, password)).toBe(true);
  });

  it("exits 1 on an unknown flag, without echoing it, and creates nothing", async () => {
    const result = await runSeed({
      username: "vt-seed-owner",
      password: newPassword(),
      args: ["--vt-unknown-flag"],
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unknown argument");
    expect(result.output).not.toContain("--vt-unknown-flag");
    expect(await listOwners(db)).toHaveLength(0);
  });
});

describe("--rotate-password", () => {
  it("replaces the password, revokes that owner's sessions and leaves the rest alone", async () => {
    const oldPassword = newPassword();
    expect((await runSeed({ username: "vt-seed-owner", password: oldPassword })).code).toBe(0);
    const before = await onlyOwner();
    await insertSession(db, { ownerId: before.id });
    await insertSession(db, { ownerId: before.id });

    const newer = newPassword();
    const result = await runSeed({
      username: "vt-seed-owner",
      password: newer,
      args: ["--rotate-password"],
    });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("2 session(s) revoked");
    const after = await onlyOwner();
    // The rotation never touches the role or the primary flag.
    const role = await db.query("SELECT is_primary, role_id FROM platform_owners WHERE id = $1", [after.id]);
    expect(role.rows[0]).toMatchObject({ is_primary: true });
    expect(after.password_hash).not.toBe(before.password_hash);
    expect(after.password_hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(after.password_hash, newer)).toBe(true);
    expect(await verifyPassword(after.password_hash, oldPassword)).toBe(false);
    expect(after.id).toBe(before.id);
    expect(after.username).toBe(before.username);
    expect(after.status).toBe(before.status);
    expect(await listSessions(db)).toHaveLength(0);
  });

  it("keeps a disabled account disabled", async () => {
    expect((await runSeed({ username: "vt-seed-owner", password: newPassword() })).code).toBe(0);
    await db.query("UPDATE platform_owners SET status = 'disabled'");

    const result = await runSeed({
      username: "vt-seed-owner",
      password: newPassword(),
      args: ["--rotate-password"],
    });

    expect(result.code, result.stderr).toBe(0);
    expect((await onlyOwner()).status).toBe("disabled");
  });

  it("exits 1 and changes nothing when the username does not exist", async () => {
    const password = newPassword();
    expect((await runSeed({ username: "vt-seed-owner", password })).code).toBe(0);
    const before = await onlyOwner();
    const session = await insertSession(db, { ownerId: before.id });

    const result = await runSeed({
      username: "vt-seed-nobody",
      password: newPassword(),
      args: ["--rotate-password"],
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("nothing was changed");
    expect(await onlyOwner()).toStrictEqual(before);
    expect((await listSessions(db)).map((row) => row.id)).toStrictEqual([session.id]);
  });

  it("exits 1 and creates nothing when the table is empty", async () => {
    const result = await runSeed({
      username: "vt-seed-owner",
      password: newPassword(),
      args: ["--rotate-password"],
    });

    expect(result.code).toBe(1);
    expect(await listOwners(db)).toHaveLength(0);
  });
});

describe("[R13] the seed reveals nothing sensitive when the database is unreachable", () => {
  const cases: [name: string, env: Record<string, string>][] = [
    ["on a closed port", { POSTGRES_HOST: "127.0.0.1", POSTGRES_PORT: "1" }],
    ["with a wrong database password", { POSTGRES_PASSWORD: "vt-wrong-db-password-0001" }],
  ];

  it.each(cases)("exits 1 %s without printing a password or a connection string", async (_name, env) => {
    const password = newPassword();
    const result = await runSeed({ username: "vt-seed-owner", password, env });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("[seed] database error, nothing was changed.");
    const databasePassword = process.env.POSTGRES_PASSWORD ?? "";
    expect(databasePassword.length).toBeGreaterThan(0);
    for (const secret of [databasePassword, env.POSTGRES_PASSWORD, password]) {
      if (secret) expect(result.output.includes(secret), "the output contains a secret").toBe(false);
    }
    expect(result.output).not.toMatch(/postgres(ql)?:\/\//i);
    expect(await listOwners(db)).toHaveLength(0);
  });
});

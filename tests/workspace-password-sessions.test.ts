/** AUD-20261017-001/002: real tenant transactions and controlled login/reset interleavings. */
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as passwords from "@/lib/platform-auth/password";
import { loadTenantDatabase } from "@/lib/tenants/database-target";
import { resetMasterPassword } from "@/lib/tenants/service";
import { updateTenantAdminRow } from "@/lib/tenants/service/tenant-admin";
import { authenticateWorkspaceUser } from "@/lib/workspace/login";
import { createUserSession, validateUserSession, type SessionArea } from "@/lib/workspace/sessions";
import { closeAppDatabase, closeAppRedis } from "./support/app-connections";
import { captureConsole } from "./support/console";
import { clearTenantTables, connectToTestDatabase } from "./support/postgres";
import { closeRbacTenant, insertCustomer, insertUser, openRbacTenant, type RbacTenant } from "./support/rbac";
import { connectAs, TenantResources } from "./support/tenant-resources";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let control: Client;
let resources: TenantResources;
let tenant: RbacTenant;
let output: ReturnType<typeof captureConsole>;
const secrets = new Set<string>();
const actor = () => ({ ownerId: randomUUID(), ipAddress: "203.0.113.241" });

beforeAll(async () => {
  output = captureConsole();
  control = await connectToTestDatabase();
  await clearTenantTables(control);
  resources = await TenantResources.open(control);
  tenant = await openRbacTenant("pwreset", randomUUID());
  secrets.add(tenant.tenant.adminPassword);
});

afterAll(async () => {
  await closeRbacTenant(tenant);
  await resources?.cleanup();
  await clearTenantTables(control);
  await resources?.close();
  await control?.end();
  await closeAppDatabase();
  await closeAppRedis();
  vi.restoreAllMocks();
});

/**
 * Description: Read a fixture's password hash and track real hashes for log checks.
 * Input: User ID, defaulting to the tenant administrator.
 * Output: The nonempty stored hash; throws for an unusable fixture.
 * Use case: Capture the hash that session issuance must still match.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
async function storedHash(userId = tenant.adminId): Promise<string> {
  const row = await tenant.ws.db.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
  if (!row.passwordHash) throw new Error("fixture needs a password");
  if (row.passwordHash.startsWith("$argon2id$")) secrets.add(row.passwordHash);
  return row.passwordHash;
}

/**
 * Description: Issue a fixture session with its captured current hash.
 * Input: User ID and portal area, defaulting to the tenant administrator.
 * Output: A session token; throws if the fixture is refused.
 * Use case: Establish sessions before reset and preserve legitimate controls.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
async function session(userId = tenant.adminId, area: SessionArea = "tenant"): Promise<string> {
  const token = await createUserSession(tenant.ws.db, tenant.tenant.id, userId, area, await storedHash(userId));
  if (!token) throw new Error("fixture session refused");
  secrets.add(token);
  return token;
}

/**
 * Description: Reset the fixture administrator through the real platform service.
 * Input: Automatic or manual generation mode.
 * Output: Nothing; requires success and remembers the new legitimate password.
 * Use case: Test reset containment without replacing the reset implementation.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
async function reset(mode: "auto" | "manual" = "manual"): Promise<void> {
  const password = `Reset-${randomUUID()}`;
  const result = await resetMasterPassword(
    tenant.tenant.id, mode === "auto" ? { mode } : { mode, password }, actor(),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("reset refused");
  tenant.tenant.adminPassword = result.generatedPassword ?? password;
  secrets.add(tenant.tenant.adminPassword);
}

/**
 * Description: Observe a transaction waiting on this test's exact blocker.
 * Input: The blocker connection's PostgreSQL process ID.
 * Output: Nothing; throws if no matching waiter appears within the bounded poll.
 * Use case: Exercise reset/login orderings without timing guesses or unrelated locks.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
async function waitForBlockedBy(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await control.query(
      "SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))", [pid],
    );
    if (result.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("the expected transaction did not wait on the user lock");
}

describe("workspace password reset containment", () => {
  it.each(["auto", "manual"] as const)("%s master reset revokes every prior admin session, preserving other users", async (mode) => {
    const tokens = [await session(), await session()];
    const otherId = await insertUser(tenant.rt, { handle: "unrelated" });
    const otherToken = await session(otherId);
    await reset(mode);
    for (const token of tokens) {
      expect(await validateUserSession(tenant.ws.db, tenant.tenant.id, "tenant", token)).toBeNull();
    }
    expect(await tenant.ws.db.userSession.count({ where: { userId: tenant.adminId } })).toBe(0);
    expect(await validateUserSession(tenant.ws.db, tenant.tenant.id, "tenant", otherToken)).toMatchObject({ id: otherId });
    const login = await authenticateWorkspaceUser(tenant.ws, {
      identifier: tenant.tenant.adminUsername, password: tenant.tenant.adminPassword,
    }, "198.51.100.241");
    expect(login).toMatchObject({ ok: true, destination: "tenant" });
    if (login.ok) {
      secrets.add(login.token);
      expect(await validateUserSession(tenant.ws.db, tenant.tenant.id, "tenant", login.token)).toMatchObject({ id: tenant.adminId });
    }
  });

  it("rolls the password change back if session revocation fails", async () => {
    const hash = await storedHash();
    const token = await session();
    await resources.queryIn((await loadTenantDatabase(tenant.tenant.id)).database, `CREATE FUNCTION test_refuse_session_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated revocation failure'; END $$`);
    await resources.queryIn((await loadTenantDatabase(tenant.tenant.id)).database, `CREATE TRIGGER test_refuse_session_delete BEFORE DELETE ON user_sessions
      FOR EACH ROW EXECUTE FUNCTION test_refuse_session_delete()`);
    try {
      const password = `Reset-${randomUUID()}`;
      const next = await passwords.hashPassword(password);
      secrets.add(password);
      secrets.add(next);
      expect(await updateTenantAdminRow(tenant.tenant.id, tenant.tenant.adminUsername, { passwordHash: next }))
        .toStrictEqual({ ok: false, problem: "unavailable" });
      expect((await storedHash()) === hash).toBe(true);
      expect(await validateUserSession(tenant.ws.db, tenant.tenant.id, "tenant", token)).toMatchObject({ id: tenant.adminId });
    } finally {
      await resources.queryIn((await loadTenantDatabase(tenant.tenant.id)).database, "DROP TRIGGER test_refuse_session_delete ON user_sessions");
      await resources.queryIn((await loadTenantDatabase(tenant.tenant.id)).database, "DROP FUNCTION test_refuse_session_delete()");
    }
  });

  it("refuses a nonprimary account matching a stale admin username", async () => {
    const userId = await insertUser(tenant.rt, { handle: "replacement" });
    const user = await tenant.ws.db.user.findUniqueOrThrow({ where: { id: userId } });
    const token = await session(userId);
    expect(await updateTenantAdminRow(tenant.tenant.id, user.username!, { passwordHash: "replacement-hash" }))
      .toStrictEqual({ ok: false, problem: "missing" });
    expect((await storedHash(userId)) === user.passwordHash).toBe(true);
    expect(await validateUserSession(tenant.ws.db, tenant.tenant.id, "tenant", token)).toMatchObject({ id: userId });
  });

  it("preserves sessions during an ordinary admin email edit", async () => {
    const token = await session();
    const email = `edited-${randomUUID()}@example.com`;
    try {
      expect(await updateTenantAdminRow(tenant.tenant.id, tenant.tenant.adminUsername, { email })).toStrictEqual({ ok: true });
      expect(await validateUserSession(tenant.ws.db, tenant.tenant.id, "tenant", token)).toMatchObject({ id: tenant.adminId, email });
    } finally {
      await updateTenantAdminRow(tenant.tenant.id, tenant.tenant.adminUsername, { email: tenant.tenant.adminEmail });
    }
  });

  it("refuses disabled and missing users without issuing a session", async () => {
    const userId = await insertUser(tenant.rt, { handle: "disabled" });
    const hash = await storedHash(userId);
    await tenant.ws.db.user.update({ where: { id: userId }, data: { status: "disabled" } });
    expect(await createUserSession(tenant.ws.db, tenant.tenant.id, userId, "tenant", hash)).toBeNull();
    expect(await createUserSession(tenant.ws.db, tenant.tenant.id, randomUUID(), "tenant", hash)).toBeNull();
    expect(await tenant.ws.db.userSession.count({ where: { userId } })).toBe(0);
  });

  it.each(["tenant", "customer"] as const)("refuses stale or absent hashes in the %s session boundary", async (area) => {
    const customerId = area === "customer" ? await insertCustomer(tenant.rt, "Reset customer", null) : undefined;
    const userId = await insertUser(tenant.rt, { handle: "stale", customerId });
    const previous = await storedHash(userId);
    await tenant.ws.db.user.update({ where: { id: userId }, data: { passwordHash: "changed-hash" } });
    expect(await createUserSession(tenant.ws.db, tenant.tenant.id, userId, area, previous)).toBeNull();
    await tenant.ws.db.user.update({ where: { id: userId }, data: { passwordHash: null } });
    expect(await createUserSession(tenant.ws.db, tenant.tenant.id, userId, area, previous)).toBeNull();
    expect(await tenant.ws.db.userSession.count({ where: { userId } })).toBe(0);
  });

  it("refuses a complete login paused after verifying the old password when reset commits first", async () => {
    const verified = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const original = passwords.verifyPassword;
    const spy = vi.spyOn(passwords, "verifyPassword").mockImplementationOnce(async (hash, password) => {
      const ok = await original(hash, password);
      verified.resolve();
      await resume.promise;
      return ok;
    });
    const login = authenticateWorkspaceUser(tenant.ws, {
      identifier: tenant.tenant.adminUsername, password: tenant.tenant.adminPassword,
    }, "198.51.100.242");
    try {
      await verified.promise;
      await reset();
    } finally {
      resume.resolve();
      spy.mockRestore();
    }
    expect(await login).toStrictEqual({ ok: false, reason: "invalid_credentials" });
    expect(await tenant.ws.db.userSession.count({ where: { userId: tenant.adminId } })).toBe(0);
  });

  it("waits for an uncommitted reset, then refuses the old hash", async () => {
    const hash = await storedHash();
    const target = await loadTenantDatabase(tenant.tenant.id);
    const blocker = await connectAs(target);
    let pending: ReturnType<typeof createUserSession> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [tenant.adminId]);
      const pid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      pending = createUserSession(tenant.ws.db, tenant.tenant.id, tenant.adminId, "tenant", hash);
      await waitForBlockedBy(pid);
      await blocker.query("UPDATE users SET password_hash = $2 WHERE id = $1", [tenant.adminId, "changed-during-reset"]);
      await blocker.query("DELETE FROM user_sessions WHERE user_id = $1", [tenant.adminId]);
      await blocker.query("COMMIT");
      expect(await pending).toBeNull();
    } finally {
      await blocker.query("ROLLBACK");
      await blocker.end();
      await pending;
      // Restore the fixture's known password for subsequent legitimate logins.
      await reset();
    }
  });

  it("revokes a session that commits while reset is waiting for its user lock", async () => {
    const target = await loadTenantDatabase(tenant.tenant.id);
    const blocker = await connectAs(target);
    let pending: Promise<void> | undefined;
    let token: string | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM users WHERE id = $1 FOR SHARE", [tenant.adminId]);
      const pid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      pending = reset();
      await waitForBlockedBy(pid);
      token = await session();
      await blocker.query("COMMIT");
      await pending;
      expect(await validateUserSession(tenant.ws.db, tenant.tenant.id, "tenant", token)).toBeNull();
    } finally {
      await blocker.query("ROLLBACK");
      await blocker.end();
      await pending;
    }
  });

  it("never logs the credentials, hashes or session tokens used by these checks", () => {
    for (const secret of secrets) expect(output.text().includes(secret)).toBe(false);
  });
});

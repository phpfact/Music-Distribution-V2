/** AUD-20261017-004/005: real tenant locks, durable recovery and registration reservations. */
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getControlDb } from "@/lib/db/control";
import { verifyPassword } from "@/lib/platform-auth/password";
import { IDENTITY_LOCK_ID } from "@/lib/workspace/identity";
import { loadTenantDatabase } from "@/lib/tenants/database-target";
import { getTenantForEdit, resetMasterPassword, updateTenantProfile, type UpdateTenantInput } from "@/lib/tenants/service";
import { closeAppDatabase, closeAppRedis } from "./support/app-connections";
import { captureConsole } from "./support/console";
import { clearTenantTables, connectToTestDatabase } from "./support/postgres";
import { closeRbacTenant, openRbacTenant, type RbacTenant } from "./support/rbac";
import { TenantResources } from "./support/tenant-resources";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let control: Client;
let resources: TenantResources;
let tenant: RbacTenant;

beforeAll(async () => {
  captureConsole();
  control = await connectToTestDatabase();
  await clearTenantTables(control);
  resources = await TenantResources.open(control);
  tenant = await openRbacTenant("identity", randomUUID());
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
 * Description: Build a profile request from the saved form values.
 * Input: Fields changed by this test.
 * Output: A valid complete request, preserving unrelated profile values.
 * Use case: Exercise real edit behavior and exact stale submissions.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
async function editInput(change: Partial<UpdateTenantInput> = {}): Promise<UpdateTenantInput> {
  const saved = await getTenantForEdit(tenant.tenant.id);
  if (!saved) throw new Error("fixture profile missing");
  return {
    fullName: saved.fullName, phone: saved.phone ?? "", username: saved.username,
    email: saved.email, subdomain: saved.subdomain, customDomain: saved.customDomain ?? "",
    profileImage: { action: "keep" }, ...change,
  };
}

/**
 * Description: Submit a profile request through the real tenant service.
 * Input: A valid request.
 * Output: The service's normal success/field-error result.
 * Use case: Test authorized owner edits without bypassing synchronization.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
function edit(input: UpdateTenantInput) {
  return updateTenantProfile(tenant.tenant.id, input, { ownerId: randomUUID(), ipAddress: "203.0.113.211" });
}

describe("tenant administrator identity integrity", () => {
  it.each(["pending", "rejected"] as const)("preserves %s registration username/email reservations", async (status) => {
    const suffix = randomUUID().slice(0, 8);
    const registration = await tenant.ws.db.customerRegistration.create({ data: {
      fullName: "Test Applicant", username: `applicant-${suffix}`, email: `applicant-${suffix}@example.com`,
      passwordHash: "fixture-hash", accountType: "artist", status,
      ...(status === "rejected" ? { rejectionReason: "Test rejection" } : {}),
    } });
    const before = await tenant.ws.db.user.findUniqueOrThrow({ where: { id: tenant.adminId } });
    const result = await edit(await editInput({ username: registration.username, email: registration.email }));
    expect(result).toMatchObject({ ok: false, reason: "validation", fieldErrors: {
      username: expect.stringContaining("registration"), email: expect.stringContaining("registration"),
    } });
    const saved = await getTenantForEdit(tenant.tenant.id);
    expect(saved?.username).toBe(before.username);
    expect(saved?.email).toBe(before.email);
    expect(await tenant.ws.db.user.findUniqueOrThrow({ where: { id: tenant.adminId } })).toStrictEqual(before);
    await tenant.ws.db.customerRegistration.delete({ where: { id: registration.id } });
  });

  it("rejects an overlapping stale edit and leaves both databases on the successful revision", async () => {
    const input = await editInput();
    const firstEmail = `first-${randomUUID()}@example.com`;
    const secondEmail = `second-${randomUUID()}@example.com`;
    // Hold the shared lock until both requests have read the same control revision.
    await tenant.rt.query("BEGIN");
    await tenant.rt.query("SELECT pg_advisory_xact_lock($1::bigint)", [IDENTITY_LOCK_ID]);
    const pid = (await tenant.rt.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    const edits = [edit({ ...input, email: firstEmail }), edit({ ...input, email: secondEmail })] as const;
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const blocked = await control.query<{ count: number }>(
          "SELECT count(*)::int FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))", [pid],
        );
        if (blocked.rows[0]!.count === 2) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waiting).toBe(true);
    } finally {
      await tenant.rt.query("COMMIT");
    }
    const [first, second] = await Promise.all(edits);
    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    expect([first, second].find((result) => !result.ok)).toMatchObject({ ok: false, reason: "invalid_state" });
    const saved = await getControlDb().tenant.findUniqueOrThrow({ where: { id: tenant.tenant.id } });
    const admin = await tenant.ws.db.user.findUniqueOrThrow({ where: { id: tenant.adminId } });
    expect(saved.contactEmail).toBe(admin.email);
    expect(saved.adminUserId).toBe(tenant.adminId);
    expect(saved.adminIdentitySyncPending).toBe(false);
  });

  it("retains durable desired state after a tenant commit fails and recovers on a no-change edit", async () => {
    const target = await loadTenantDatabase(tenant.tenant.id);
    const username = `recovered-${randomUUID().slice(0, 8)}`;
    await resources.queryIn(target.database, `CREATE FUNCTION test_refuse_identity() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated tenant write failure'; END $$`);
    await resources.queryIn(target.database, `CREATE TRIGGER test_refuse_identity BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION test_refuse_identity()`);
    try {
      expect(await edit(await editInput({ username }))).toMatchObject({ ok: false, reason: "unavailable" });
      const saved = await getControlDb().tenant.findUniqueOrThrow({ where: { id: tenant.tenant.id } });
      expect(saved.adminUsername).toBe(username);
      expect(saved.adminUserId).toBe(tenant.adminId);
      expect(saved.adminIdentitySyncPending).toBe(true);
      expect((await tenant.ws.db.user.findUniqueOrThrow({ where: { id: tenant.adminId } })).username).not.toBe(username);
    } finally {
      await resources.queryIn(target.database, "DROP TRIGGER test_refuse_identity ON users");
      await resources.queryIn(target.database, "DROP FUNCTION test_refuse_identity()");
    }
    expect(await edit(await editInput())).toMatchObject({ ok: true, changed: [] });
    expect((await tenant.ws.db.user.findUniqueOrThrow({ where: { id: tenant.adminId } })).username).toBe(username);
    expect((await getControlDb().tenant.findUniqueOrThrow({ where: { id: tenant.tenant.id } })).adminIdentitySyncPending).toBe(false);
  });

  it("recovers an interrupted rename by immutable ID before a master-password reset", async () => {
    const username = `resumed-${randomUUID().slice(0, 8)}`;
    // Simulates termination after durable control commit but before tenant commit.
    await getControlDb().tenant.update({ where: { id: tenant.tenant.id }, data: {
      adminUserId: tenant.adminId, adminUsername: username, adminIdentitySyncPending: true,
      adminIdentityVersion: { increment: 1 },
    } });
    const password = `Recovery-${randomUUID()}`;
    expect(await resetMasterPassword(tenant.tenant.id, { mode: "manual", password }, { ownerId: randomUUID(), ipAddress: "203.0.113.211" })).toStrictEqual({ ok: true });
    const admin = await tenant.ws.db.user.findUniqueOrThrow({ where: { id: tenant.adminId } });
    expect(admin.username).toBe(username);
    expect(await verifyPassword(admin.passwordHash!, password)).toBe(true);
    expect((await getControlDb().tenant.findUniqueOrThrow({ where: { id: tenant.tenant.id } })).adminIdentitySyncPending).toBe(false);
  });
});

/**
 * Sub-user management services against the REAL databases
 * (src/lib/authz/sub-user-service.ts, .vibe/memory/role-privilege-management.md):
 * Sub-Platform Owners on the control plane, Sub-Tenants and Sub-Customers on
 * two real provisioned tenants — exactly one role, master/primary/self
 * protection, the delegation ceiling, uniqueness (pending registrations
 * included), sessions on suspend / password change, isolation, concurrency.
 */
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadPlatformAccess } from "@/lib/authz/platform-access";
import {
  createSubUser,
  getSubUserEditModel,
  getSubUserSummary,
  listSubUserCountRecords,
  listSubUsers,
  setSubUserStatus,
  updateSubUser,
} from "@/lib/authz/sub-user-service";
import { resolveWorkspaceAccess } from "@/lib/authz/workspace-access";
import { getControlDb } from "@/lib/db/control";
import { verifyPassword } from "@/lib/platform-auth/password";
import { createSession } from "@/lib/platform-auth/session";
import { setCustomerAccountStatus } from "@/lib/workspace/registrations";
import { validateUserSession } from "@/lib/workspace/sessions";
import { createTestUserSession as createUserSession } from "./support/workspace-session";
import { closeAppDatabase } from "./support/app-connections";
import {
  clearPlatformTables,
  clearTenantTables,
  connectToTestDatabase,
  insertOwner,
  insertPlatformRole,
  listSessions,
  masterPlatformRoleId,
} from "./support/postgres";
import {
  approvedCustomer,
  assignRole,
  auditRows,
  closeRbacTenant,
  customerActorOf,
  insertRole,
  insertUser,
  letters,
  one,
  openRbacTenant,
  platformActorOf,
  STRONG_PASSWORD,
  suffix,
  tenantActorOf,
  waitForLockWaiter,
  type RbacTenant,
} from "./support/rbac";
import { TenantResources } from "./support/tenant-resources";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo";

let control: Client;
let resources: TenantResources;
let tenantA: RbacTenant;
let tenantB: RbacTenant;

// Platform fixtures.
let masterRoleId: string;
let ownerM: string; // primary master
let ownerL: string; // limited users manager
let limitedRoleId: string;
let viewerRoleId: string;
let editorRoleId: string;
let highRoleId: string;

/** A create form with valid defaults. */
function createForm(overrides: Record<string, unknown> = {}) {
  const handle = `vt-sub-${suffix()}`;
  return {
    fullName: `Sub User ${letters()}`,
    accountType: "artist",
    username: handle,
    email: `${handle}@example.com`,
    password: STRONG_PASSWORD,
    confirmPassword: STRONG_PASSWORD,
    roleId: [] as unknown,
    ...overrides,
  };
}

beforeAll(async () => {
  control = await connectToTestDatabase();
  await clearPlatformTables(control);
  await clearTenantTables(control);
  resources = await TenantResources.open(control);

  masterRoleId  = await masterPlatformRoleId(control);
  ownerM        = await insertOwner(control, { username: `vt-m-${suffix()}`, passwordHash: HASH });
  await control.query("UPDATE platform_owners SET is_primary = true WHERE id = $1", [ownerM]);
  limitedRoleId = await insertPlatformRole(control, {
    name: `VT Users Manager ${suffix()}`,
    permissionKeys: ["platform.users.view", "platform.users.create", "platform.users.edit", "platform.users.suspend", "platform.tenants.view"],
  });
  ownerL       = await insertOwner(control, { username: `vt-l-${suffix()}`, passwordHash: HASH, roleId: limitedRoleId });
  viewerRoleId = await insertPlatformRole(control, { name: `VT Viewer ${suffix()}`, permissionKeys: ["platform.tenants.view"] });
  editorRoleId = await insertPlatformRole(control, { name: `VT Users View ${suffix()}`, permissionKeys: ["platform.users.view"] });
  highRoleId   = await insertPlatformRole(control, { name: `VT High ${suffix()}`, permissionKeys: ["platform.tenants.view", "platform.tenants.create"] });

  tenantA = await openRbacTenant("rbacua", randomUUID());
  tenantB = await openRbacTenant("rbacub", randomUUID());
});

afterAll(async () => {
  await closeRbacTenant(tenantA);
  await closeRbacTenant(tenantB);
  await resources?.cleanup();
  await clearTenantTables(control);
  await clearPlatformTables(control);
  await resources?.close();
  await control.end();
  await closeAppDatabase();
});

// ---------------------------------------------------------------------------

describe("Sub-Platform Owners", () => {
  it("needs exactly one valid, assignable role id", async () => {
    const actor = await platformActorOf(ownerL);
    const tenantRole = tenantA.masterTenantId;
    const cases: unknown[] = [[], [viewerRoleId, editorRoleId], ["not-a-uuid"], [randomUUID()], [tenantRole], undefined];
    for (const roleId of cases) {
      const result = await createSubUser(actor, createForm({ roleId }));
      expect(result).toMatchObject({ ok: false, fieldErrors: { roleId: expect.any(String) } });
    }
    expect(await createSubUser(actor, createForm({ roleId: [viewerRoleId, editorRoleId] }))).toMatchObject({
      fieldErrors: { roleId: "Choose exactly one role." },
    });
    // Above the ceiling and the master role are refused for a non-master actor (and audited).
    expect(await createSubUser(actor, createForm({ roleId: [highRoleId] }))).toMatchObject({ ok: false, fieldErrors: { roleId: expect.stringContaining("beyond") } });
    expect(await createSubUser(actor, createForm({ roleId: [masterRoleId] }))).toMatchObject({
      ok: false,
      fieldErrors: { roleId: expect.stringContaining("master role") },
    });
    const attempts = (await auditRows(control, "authz.escalation_blocked", ownerL)).map((row) => row.metadata?.attempt);
    expect(attempts).toEqual(expect.arrayContaining(["above_ceiling", "master_requires_master"]));
  });

  it("creates with one role (hashed password, never primary); master is assignable by a master holder only", async () => {
    const limited = await platformActorOf(ownerL);
    const form    = createForm({ roleId: [viewerRoleId] });
    const created = await createSubUser(limited, form);
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;
    const row = await control.query("SELECT username, full_name, role_id, is_primary, created_by_id, password_hash FROM platform_owners WHERE id = $1", [created.userId]);
    expect(row.rows[0]).toMatchObject({ username: form.username, full_name: form.fullName, role_id: viewerRoleId, is_primary: false, created_by_id: ownerL });
    expect(await verifyPassword(row.rows[0].password_hash, STRONG_PASSWORD)).toBe(true);
    expect(JSON.stringify(created)).not.toContain(STRONG_PASSWORD);

    // Duplicate username.
    expect(await createSubUser(limited, createForm({ username: form.username, roleId: [viewerRoleId] }))).toMatchObject({
      ok: false,
      fieldErrors: { username: expect.stringContaining("taken") },
    });

    // The master holder may hand out the master role (audited).
    const master = await platformActorOf(ownerM);
    const second = await createSubUser(master, createForm({ roleId: [masterRoleId] }));
    expect(second).toMatchObject({ ok: true });
    if (second.ok) expect((await auditRows(control, "master_role.assigned", ownerM)).at(-1)?.target_id).toBe(second.userId);
  });

  it("never manages self or the primary account; master holders only by masters", async () => {
    const master  = await platformActorOf(ownerM);
    const limited = await platformActorOf(ownerL);
    expect(await updateSubUser(master, ownerM, { fullName: "Master Self", roleId: [masterRoleId] })).toMatchObject({
      ok: false,
      error: "You cannot change your own account here.",
    });
    expect(await setSubUserStatus(limited, ownerL, "suspend")).toMatchObject({ ok: false, error: "You cannot change your own account here." });
    expect(await setSubUserStatus(limited, ownerM, "suspend")).toMatchObject({ ok: false, error: expect.stringContaining("primary") });

    const otherMaster = await insertOwner(control, { username: `vt-om-${suffix()}`, passwordHash: HASH });
    expect(await setSubUserStatus(limited, otherMaster, "suspend")).toMatchObject({ ok: false, error: expect.stringContaining("master role") });
    // A user whose role is above the ceiling is out of reach too.
    const high = await insertOwner(control, { username: `vt-hi-${suffix()}`, passwordHash: HASH, roleId: highRoleId });
    expect(await updateSubUser(limited, high, { fullName: "High User", roleId: [viewerRoleId] })).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await one(control, "SELECT role_id::text AS id FROM platform_owners WHERE id = $1", [high])).toBe(highRoleId);

    // The edit model says so too.
    const model = await getSubUserEditModel(limited, ownerM);
    expect(model).toMatchObject({ ok: true, data: { manageable: false, manageableReason: "primary" } });
  });

  it("reassignment replaces the old role; a new password ends the sessions; suspend ends them too", async () => {
    const limited = await platformActorOf(ownerL);
    const created = await createSubUser(limited, createForm({ roleId: [viewerRoleId] }));
    if (!created.ok) throw new Error("setup failed");
    const userId = created.userId;
    expect((await loadPlatformAccess(getControlDb(), userId)).permissions).toStrictEqual(["platform.tenants.view"]);

    const hash = await one(control, "SELECT password_hash AS id FROM platform_owners WHERE id = $1", [userId]);
    expect(await createSession(userId, hash)).not.toBeNull();

    const updated = await updateSubUser(limited, userId, {
      fullName: "Renamed Sub User",
      roleId: [editorRoleId],
      password: "Another-Pass-2026!",
      confirmPassword: "Another-Pass-2026!",
    });
    expect(updated).toMatchObject({ ok: true });
    // The old role's privileges are gone on the next read.
    expect((await loadPlatformAccess(getControlDb(), userId)).permissions).toStrictEqual(["platform.users.view"]);
    expect(await listSessions(control, userId)).toHaveLength(0);
    expect((await auditRows(control, "user.password_reset", ownerL)).at(-1)?.target_id).toBe(userId);
    expect((await auditRows(control, "user.role_changed", ownerL)).at(-1)?.metadata).toMatchObject({ fromRoleId: viewerRoleId, toRoleId: editorRoleId });

    // Suspend: sessions deleted, status disabled; twice → conflict; reactivate works.
    const newHash = await one(control, "SELECT password_hash AS id FROM platform_owners WHERE id = $1", [userId]);
    expect(await createSession(userId, newHash)).not.toBeNull();
    expect(await setSubUserStatus(limited, userId, "suspend")).toMatchObject({ ok: true });
    expect(await listSessions(control, userId)).toHaveLength(0);
    expect(await setSubUserStatus(limited, userId, "suspend")).toMatchObject({ ok: false, reason: "conflict" });
    expect(await setSubUserStatus(limited, userId, "reactivate")).toMatchObject({ ok: true });
    expect(await setSubUserStatus(limited, userId, "pause")).toMatchObject({ ok: false, reason: "validation" });
  });

  it("lists with server-side search and filters, and explains the summary", async () => {
    const master  = await platformActorOf(ownerM);
    const summary = await getSubUserSummary(master);
    if (!summary.ok) throw new Error("summary failed");
    expect(summary.data.total).toBe(Number(await one(control, "SELECT count(*)::text AS id FROM platform_owners")));
    expect(summary.data.active + summary.data.suspended).toBe(summary.data.total);

    const byRole = await listSubUsers(master, { q: "", status: "all", roleId: limitedRoleId, page: 1 });
    expect(byRole).toMatchObject({ ok: true, data: { total: 1, rows: [{ id: ownerL, roleId: limitedRoleId, email: null }] } });
    const self = await listSubUsers(master, { q: "", status: "all", roleId: masterRoleId, page: 1 });
    expect(self.ok && self.data.rows.find((row) => row.id === ownerM)).toMatchObject({ isSelf: true, isPrimary: true, manageable: false, roleIsMaster: true });

    const records = await listSubUserCountRecords(master, "active", 1);
    expect(records).toMatchObject({ ok: true, data: { category: "active", page: { total: summary.data.active } } });
  });
});

// ---------------------------------------------------------------------------

describe("Sub-Tenants", () => {
  it("creates staff users; email/username taken by accounts or pending registrations are refused", async () => {
    const admin = await tenantActorOf(tenantA, tenantA.adminId);
    const role  = await insertRole(tenantA.rt, { name: `VT Staff ${suffix()}`, domain: "tenant", keys: ["tenant.registrations.view"] });
    const form  = createForm({ roleId: [role] });
    const created = await createSubUser(admin, form);
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;
    const row = await tenantA.rt.query(
      "SELECT u.customer_id, u.is_primary, ur.role_id FROM users u JOIN user_roles ur ON ur.user_id = u.id WHERE u.id = $1",
      [created.userId],
    );
    expect(row.rows).toStrictEqual([{ customer_id: null, is_primary: false, role_id: role }]);

    // Taken by an account.
    expect(await createSubUser(admin, createForm({ email: form.email.toUpperCase(), username: form.username, roleId: [role] }))).toMatchObject({
      ok: false,
      fieldErrors: { email: expect.any(String), username: expect.any(String) },
    });
    // Taken by a pending registration.
    const pending = `vt-pend-${suffix()}`;
    await tenantA.rt.query(
      `INSERT INTO customer_registrations (id, full_name, email, username, password_hash, account_type, updated_at)
       VALUES (gen_random_uuid(), 'Pending Person', $1, $2, 'h', 'artist', now())`,
      [`${pending}@example.com`, pending],
    );
    expect(await createSubUser(admin, createForm({ email: `${pending}@example.com`, username: pending, roleId: [role] }))).toMatchObject({
      ok: false,
      fieldErrors: { email: expect.stringContaining("pending"), username: expect.stringContaining("pending") },
    });

    // A role of the other domain (Master Customer) is not a tenant role.
    expect(await createSubUser(admin, createForm({ roleId: [tenantA.masterCustomerId] }))).toMatchObject({ ok: false, fieldErrors: { roleId: expect.any(String) } });
    // The primary admin and the actor itself are never manageable.
    expect(await setSubUserStatus(admin, tenantA.adminId, "suspend")).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("reassignment replaces; concurrent assignments leave exactly one role", async () => {
    const admin  = await tenantActorOf(tenantA, tenantA.adminId);
    const roleA  = await insertRole(tenantA.rt, { name: `VT Ra ${suffix()}`, domain: "tenant", keys: ["tenant.registrations.view"] });
    const roleB  = await insertRole(tenantA.rt, { name: `VT Rb ${suffix()}`, domain: "tenant", keys: ["tenant.appearance.manage_workspace"] });
    const create = await createSubUser(admin, createForm({ roleId: [roleA] }));
    if (!create.ok) throw new Error("setup failed");
    const userId = create.userId;

    // The next read after the change shows only the new role's privileges.
    const token = await createUserSession(tenantA.ws.db, tenantA.tenant.id, userId, "tenant");
    const read  = async () => {
      const user = await validateUserSession(tenantA.ws.db, tenantA.tenant.id, "tenant", token);
      if (!user) throw new Error("session refused");
      return resolveWorkspaceAccess(user, "tenant", []).permissions;
    };
    expect(await read()).toStrictEqual(["tenant.registrations.view"]);
    expect(await updateSubUser(admin, userId, { fullName: "Changed Name", roleId: [roleB] })).toMatchObject({ ok: true });
    expect(await read()).toStrictEqual(["tenant.appearance.manage_workspace"]);

    // Two concurrent edits with different roles: exactly one role afterwards.
    const results = await Promise.all([
      updateSubUser(admin, userId, { fullName: "Changed Name", roleId: [roleA] }),
      updateSubUser(admin, userId, { fullName: "Changed Name", roleId: [roleB] }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    const held = await tenantA.rt.query("SELECT role_id FROM user_roles WHERE user_id = $1", [userId]);
    expect(held.rows).toHaveLength(1);
    expect([roleA, roleB]).toContain(held.rows[0]?.role_id);
  });

  it("suspend deletes the sessions; tenant B's users are not found from tenant A", async () => {
    const admin = await tenantActorOf(tenantA, tenantA.adminId);
    const role  = await insertRole(tenantA.rt, { name: `VT Susp ${suffix()}`, domain: "tenant", keys: ["tenant.registrations.view"] });
    const made  = await createSubUser(admin, createForm({ roleId: [role] }));
    if (!made.ok) throw new Error("setup failed");
    const token = await createUserSession(tenantA.ws.db, tenantA.tenant.id, made.userId, "tenant");
    expect(await setSubUserStatus(admin, made.userId, "suspend")).toMatchObject({ ok: true });
    expect(await one(tenantA.rt, "SELECT count(*)::text AS id FROM user_sessions WHERE user_id = $1", [made.userId])).toBe("0");
    expect(await validateUserSession(tenantA.ws.db, tenantA.tenant.id, "tenant", token)).toBeNull();

    // A Sub-Tenant manager of A cannot see or touch B's users.
    const managerRole = await insertRole(tenantA.rt, {
      name: `VT Mgr ${suffix()}`,
      domain: "tenant",
      keys: ["tenant.users.view", "tenant.users.edit", "tenant.users.suspend", "tenant.registrations.view"],
    });
    const manager = await insertUser(tenantA.rt, { handle: "mgr" });
    await assignRole(tenantA.rt, manager, managerRole);
    const actor = await tenantActorOf(tenantA, manager);
    const userB = await insertUser(tenantB.rt, { handle: "userb" });
    expect(await updateSubUser(actor, userB, { fullName: "Hacked Name", roleId: [role] })).toMatchObject({ ok: false, reason: "not_found" });
    expect(await setSubUserStatus(actor, userB, "suspend")).toMatchObject({ ok: false, reason: "not_found" });
    expect(await getSubUserEditModel(actor, userB)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await one(tenantB.rt, "SELECT status::text AS id FROM users WHERE id = $1", [userB])).toBe("active");
    // B's role ids are not found either.
    const roleB = await insertRole(tenantB.rt, { name: `VT B ${suffix()}`, domain: "tenant", keys: ["tenant.users.view"] });
    expect(await createSubUser(actor, createForm({ roleId: [roleB] }))).toMatchObject({ ok: false });
    // A manager cannot touch the master admin.
    expect(await setSubUserStatus(actor, tenantA.adminId, "suspend")).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("edits only full name, role and password: a crafted email / account type / username is ignored", async () => {
    const admin = await tenantActorOf(tenantA, tenantA.adminId);
    const role  = await insertRole(tenantA.rt, { name: `VT Fixed ${suffix()}`, domain: "tenant", keys: ["tenant.registrations.view"] });
    const form  = createForm({ roleId: [role] });
    const made  = await createSubUser(admin, form);
    if (!made.ok) throw new Error("setup failed");

    // Extra fields a crafted request might add (not part of SubUserUpdateInput).
    const crafted = { fullName: "Renamed Person", roleId: [role], email: `hijack-${suffix()}@example.com`, username: `hijack-${suffix()}`, accountType: "label" };
    expect(await updateSubUser(admin, made.userId, crafted)).toMatchObject({ ok: true });
    const row = await tenantA.rt.query("SELECT name, email, username FROM users WHERE id = $1", [made.userId]);
    expect(row.rows[0]).toStrictEqual({ name: "Renamed Person", email: form.email, username: form.username });
  });

  it("a role reassignment of the actor committed while its mutation waits is honoured", async () => {
    // A Sub-Tenant manager who may create Sub-Tenants; its snapshot still says so.
    const strong = await insertRole(tenantA.rt, { name: `VT Strong ${suffix()}`, domain: "tenant", keys: ["tenant.users.view", "tenant.users.create", "tenant.registrations.view"] });
    const weak   = await insertRole(tenantA.rt, { name: `VT Weak ${suffix()}`, domain: "tenant", keys: ["tenant.users.view"] });
    const target = await insertRole(tenantA.rt, { name: `VT Target ${suffix()}`, domain: "tenant", keys: ["tenant.registrations.view"] });
    const racer  = await insertUser(tenantA.rt, { handle: "racer" });
    await assignRole(tenantA.rt, racer, strong);
    const actor = await tenantActorOf(tenantA, racer);
    expect(actor.permissions).toContain("tenant.users.create");

    // Another transaction moves the actor to the weak role (holds the user_roles row lock).
    const form = createForm({ roleId: [target] });
    try {
      await tenantA.rt.query("BEGIN");
      await tenantA.rt.query("UPDATE user_roles SET role_id = $2 WHERE user_id = $1", [racer, weak]);
      const pending = createSubUser(actor, form);
      await waitForLockWaiter(control);
      await tenantA.rt.query("COMMIT");
      expect(await pending).toMatchObject({ ok: false, reason: "forbidden" });
    } finally {
      await tenantA.rt.query("ROLLBACK").catch(() => undefined);
    }
    expect(await one(tenantA.rt, "SELECT count(*)::text AS id FROM users WHERE username = $1", [form.username])).toBe("0");
  });
});

// ---------------------------------------------------------------------------

describe("Sub-Customers", () => {
  it("creates sub-customers under the MAIN customer only, with roles of that main customer only", async () => {
    const x = await approvedCustomer(tenantA, "Xena Label");
    const y = await approvedCustomer(tenantA, "Yara Label");
    const actorX = await customerActorOf(tenantA, x.userId);

    const roleX = await insertRole(tenantA.rt, {
      name: `VT X Mgr ${suffix()}`,
      domain: "customer",
      owner: x.customerId,
      keys: ["customer.sub_customers.view", "customer.sub_customers.create", "customer.sub_customers.edit", "customer.sub_customers.suspend"],
    });
    const roleY = await insertRole(tenantA.rt, { name: `VT Y ${suffix()}`, domain: "customer", owner: y.customerId, keys: ["customer.sub_customers.view"] });

    // Another main customer's role, a tenant role and a missing account type are refused.
    expect(await createSubUser(actorX, createForm({ roleId: [roleY] }))).toMatchObject({ ok: false, fieldErrors: { roleId: expect.any(String) } });
    expect(await createSubUser(actorX, createForm({ roleId: [tenantA.masterTenantId] }))).toMatchObject({ ok: false, fieldErrors: { roleId: expect.any(String) } });
    expect(await createSubUser(actorX, createForm({ roleId: [roleX], accountType: "" }))).toMatchObject({ ok: false, fieldErrors: { accountType: expect.any(String) } });

    // The main customer creates one: customer row (parent = X) + user + role, in one transaction.
    const created = await createSubUser(actorX, createForm({ roleId: [roleX], accountType: "label" }));
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;
    const sub = await tenantA.rt.query<{ parent_id: string; type: string; customer_id: string }>(
      "SELECT c.parent_id, c.type::text AS type, c.id AS customer_id FROM users u JOIN customers c ON c.id = u.customer_id WHERE u.id = $1",
      [created.userId],
    );
    expect(sub.rows[0]).toMatchObject({ parent_id: x.customerId, type: "label" });

    // The sub-customer (with create rights) creates a sibling under X — never under itself (one level).
    const subActor = await customerActorOf(tenantA, created.userId);
    const sibling  = await createSubUser(subActor, createForm({ roleId: [roleX] }));
    expect(sibling).toMatchObject({ ok: true });
    if (sibling.ok) {
      expect(await one(tenantA.rt, "SELECT c.parent_id::text AS id FROM users u JOIN customers c ON c.id = u.customer_id WHERE u.id = $1", [sibling.userId])).toBe(
        x.customerId,
      );
    }
    // It cannot suspend itself, but can manage its sibling (same role, within its ceiling).
    expect(await setSubUserStatus(subActor, created.userId, "suspend")).toMatchObject({ ok: false, reason: "forbidden" });

    // Y cannot list or touch X's sub-customers.
    const actorY = await customerActorOf(tenantA, y.userId);
    const listY  = await listSubUsers(actorY, { q: "", status: "all", roleId: null, page: 1 });
    expect(listY).toMatchObject({ ok: true, data: { total: 0 } });
    expect(await updateSubUser(actorY, created.userId, { fullName: "Hacked Name", roleId: [roleY] })).toMatchObject({ ok: false, reason: "not_found" });
    expect(await setSubUserStatus(actorY, created.userId, "suspend")).toMatchObject({ ok: false, reason: "not_found" });
    const listX = await listSubUsers(actorX, { q: "", status: "all", roleId: null, page: 1 });
    expect(listX.ok && listX.data.rows.map((row) => row.id).sort()).toStrictEqual([created.userId, sibling.ok ? sibling.userId : ""].sort());
    expect(listX.ok && listX.data.rows.every((row) => row.accountType !== null && row.email !== null)).toBe(true);
  });

  it("suspend disables the sub-customer and ends its sessions; a suspended main customer blocks every sub-customer", async () => {
    const x = await approvedCustomer(tenantA, "Zora Label");
    const actorX = await customerActorOf(tenantA, x.userId);
    const made   = await createSubUser(actorX, createForm({ roleId: [tenantA.masterCustomerId] }));
    // Master Customer: actor X holds it, so it may hand it to its sub-customer.
    expect(made).toMatchObject({ ok: true });
    if (!made.ok) return;
    const customerId = await one(tenantA.rt, "SELECT customer_id::text AS id FROM users WHERE id = $1", [made.userId]);

    const token = await createUserSession(tenantA.ws.db, tenantA.tenant.id, made.userId, "customer");
    expect(await setSubUserStatus(actorX, made.userId, "suspend")).toMatchObject({ ok: true });
    expect(await one(tenantA.rt, "SELECT status::text AS id FROM customers WHERE id = $1", [customerId])).toBe("disabled");
    expect(await one(tenantA.rt, "SELECT count(*)::text AS id FROM user_sessions WHERE user_id = $1", [made.userId])).toBe("0");
    expect(await validateUserSession(tenantA.ws.db, tenantA.tenant.id, "customer", token)).toBeNull();
    const summary = await getSubUserSummary(actorX);
    expect(summary).toMatchObject({ ok: true, data: { total: 1, active: 0, suspended: 1 } });
    expect(await setSubUserStatus(actorX, made.userId, "reactivate")).toMatchObject({ ok: true });

    // The main customer suspended through the registrations flow: the sub-customer is refused.
    const fresh = await createUserSession(tenantA.ws.db, tenantA.tenant.id, made.userId, "customer");
    expect(await validateUserSession(tenantA.ws.db, tenantA.tenant.id, "customer", fresh)).not.toBeNull();
    const reviewer = { type: "tenant_user" as const, id: tenantA.adminId };
    expect(await setCustomerAccountStatus(tenantA.ws.db, tenantA.tenant.id, x.registrationId, "suspend", reviewer, null)).toStrictEqual({ ok: true });
    expect(await validateUserSession(tenantA.ws.db, tenantA.tenant.id, "customer", fresh)).toBeNull();
    expect(await setCustomerAccountStatus(tenantA.ws.db, tenantA.tenant.id, x.registrationId, "reactivate", reviewer, null)).toStrictEqual({ ok: true });
  });

  it("a sub-customer without master cannot hand out Master Customer nor manage the master holders", async () => {
    const x = await approvedCustomer(tenantA, "Quinn Label");
    const roleX = await insertRole(tenantA.rt, {
      name: `VT Q Mgr ${suffix()}`,
      domain: "customer",
      owner: x.customerId,
      keys: ["customer.sub_customers.view", "customer.sub_customers.create", "customer.sub_customers.edit", "customer.sub_customers.suspend"],
    });
    const actorX  = await customerActorOf(tenantA, x.userId);
    const manager = await createSubUser(actorX, createForm({ roleId: [roleX] }));
    const holder  = await createSubUser(actorX, createForm({ roleId: [tenantA.masterCustomerId] }));
    if (!manager.ok || !holder.ok) throw new Error("setup failed");

    const subActor = await customerActorOf(tenantA, manager.userId);
    expect(await createSubUser(subActor, createForm({ roleId: [tenantA.masterCustomerId] }))).toMatchObject({
      ok: false,
      fieldErrors: { roleId: expect.stringContaining("master role") },
    });
    expect(await setSubUserStatus(subActor, holder.userId, "suspend")).toMatchObject({ ok: false, error: expect.stringContaining("master role") });
  });
});

/**
 * Tenant and customer authorization against a REAL provisioned tenant
 * database (.vibe/memory/role-privilege-management.md): the catalog mirror,
 * the master roles, effective privileges through the session, module
 * switches, immediate revocation, sub-customer scope, and the database rules
 * (triggers, keys, RESTRICT) — every write as the tenant's low-privilege
 * RUNTIME login, exactly as the application writes.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { permissionKeysOfDomain, permissionsOfDomain } from "@/lib/authz/catalog";
import { loadDisabledTenantModules, resolveWorkspaceAccess } from "@/lib/authz/workspace-access";
import { getControlDb } from "@/lib/db/control";
import { loadTenantDatabase } from "@/lib/tenants/database-target";
import type { ReadyWorkspace } from "@/lib/workspace/context";
import { approveRegistration, setCustomerAccountStatus } from "@/lib/workspace/registrations";
import { createUserSession, validateUserSession, type SessionArea } from "@/lib/workspace/sessions";
import { closeAppDatabase } from "./support/app-connections";
import { clearTenantTables, connectToTestDatabase } from "./support/postgres";
import { connectAs, TenantResources, type TestLogin } from "./support/tenant-resources";
import { createProvisionedTenant, readyWorkspace, type ProvisionedTenant } from "./support/workspace";

// Provisioning a real tenant database takes a while.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const RESTRICT_VIOLATION = "23001";
const UNIQUE_VIOLATION   = "23505";
const CHECK_VIOLATION    = "23514";

let control: Client;
let resources: TenantResources;
let tenant: ProvisionedTenant;
let ws: ReadyWorkspace;
let login: TestLogin;
// Two independent runtime-login connections (not the application's pool).
let rt: Client;
let rt2: Client;

// Ids prepared in beforeAll.
let masterTenantId: string;
let masterCustomerId: string;
let adminId: string;
let customerA: { customerId: string; userId: string; registrationId: string };
let customerBId: string;
let customerBUserId: string;
let subCustomerId: string;
let subUserId: string;
let customTenantRoleId: string;
let customCustomerRoleId: string;
let staffId: string;

beforeAll(async () => {
  control = await connectToTestDatabase();
  await clearTenantTables(control);
  resources = await TenantResources.open(control);
  tenant    = await createProvisionedTenant("authz", { ownerId: randomUUID(), ipAddress: "203.0.113.210" });
  ws        = await readyWorkspace(tenant);
  const target = await loadTenantDatabase(tenant.id);
  login = { database: target.database, user: target.user, password: target.password, port: target.port };
  rt  = await connectAs(login);
  rt2 = await connectAs(login);

  // The master roles and the admin written by provisioning.
  masterTenantId   = await one(rt, "SELECT id FROM roles WHERE system_key = 'master_tenant'");
  masterCustomerId = await one(rt, "SELECT id FROM roles WHERE system_key = 'master_customer'");
  adminId          = await one(rt, "SELECT id FROM users WHERE username = $1", [tenant.adminUsername]);

  // A staff user without any role.
  staffId = await insertUser(rt, { handle: "staff" });

  // Customer A: approved through the real service (Master Customer + primary).
  customerA = await approvedCustomer("Asha Label");

  // Customer B (another main customer) with a user.
  customerBId     = await insertCustomer(rt, "Other Main", null);
  customerBUserId = await insertUser(rt, { handle: "custb", customerId: customerBId });

  // A sub-customer of A with its own user.
  subCustomerId = await insertCustomer(rt, "Asha Sub", customerA.customerId);
  subUserId     = await insertUser(rt, { handle: "sub", customerId: subCustomerId });

  // A custom tenant role and a custom customer role owned by A.
  customTenantRoleId   = await insertRole(rt, { name: "VT Registrations Clerk", domain: "tenant", keys: ["tenant.registrations.view", "tenant.users.view"] });
  customCustomerRoleId = await insertRole(rt, {
    name: "VT Sub Viewer",
    domain: "customer",
    owner: customerA.customerId,
    keys: ["customer.sub_customers.view"],
  });
  await rt.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [subUserId, customCustomerRoleId]);
});

afterAll(async () => {
  await rt?.end().catch(() => undefined);
  await rt2?.end().catch(() => undefined);
  await ws?.db.$disconnect().catch(() => undefined);
  await resources.cleanup();
  await clearTenantTables(control);
  await resources.close();
  await control.end();
  await closeAppDatabase();
});

// ---------------------------------------------------------------------------
// Helpers

/** The single value of a one-row query. */
async function one(client: Client, sql: string, values: unknown[] = []): Promise<string> {
  const result = await client.query<{ id: string }>(sql, values);
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`no row: ${sql}`);
  return id;
}

/** Inserts a user (staff when no customer is given). */
async function insertUser(client: Client, user: { handle: string; customerId?: string }): Promise<string> {
  const handle = `vt-${user.handle}-${randomBytes(3).toString("hex")}`;
  return one(
    client,
    `INSERT INTO users (id, email, username, password_hash, name, customer_id, updated_at)
     VALUES (gen_random_uuid(), $1, $2, 'h', $3, $4, now()) RETURNING id`,
    [`${handle}@example.com`, handle, `VT ${user.handle}`, user.customerId ?? null],
  );
}

/** Inserts a customer (a sub-customer when a parent is given). */
async function insertCustomer(client: Client, name: string, parentId: string | null): Promise<string> {
  return one(
    client,
    "INSERT INTO customers (id, type, name, parent_id, updated_at) VALUES (gen_random_uuid(), 'artist', $1, $2, now()) RETURNING id",
    [name, parentId],
  );
}

/** Inserts a custom role with the given catalog keys. */
async function insertRole(
  client: Client,
  role: { name: string; domain: "tenant" | "customer"; owner?: string; keys: string[]; status?: "active" | "disabled" },
): Promise<string> {
  const id = await one(
    client,
    `INSERT INTO roles (id, name, domain, owner_customer_id, status, updated_at)
     VALUES (gen_random_uuid(), $1, $2::authz_domain, $3, $4::role_status, now()) RETURNING id`,
    [role.name, role.domain, role.owner ?? null, role.status ?? "active"],
  );
  await client.query(
    "INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE key = ANY($2::text[])",
    [id, role.keys],
  );
  return id;
}

/** A pending registration approved through the real service. */
async function approvedCustomer(fullName: string): Promise<{ customerId: string; userId: string; registrationId: string }> {
  const handle = `vt-cust-${randomBytes(3).toString("hex")}`;
  const registrationId = await one(
    rt,
    `INSERT INTO customer_registrations (id, full_name, email, username, password_hash, account_type, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, '$argon2id$placeholder', 'label', now()) RETURNING id`,
    [fullName, `${handle}@example.com`, handle],
  );
  const outcome = await approveRegistration(ws.db, tenant.id, registrationId, { type: "tenant_user", id: adminId }, null);
  if (!outcome.ok) throw new Error(`approval failed: ${JSON.stringify(outcome)}`);
  const user = await rt.query<{ id: string; customer_id: string }>(
    "SELECT id, customer_id FROM users WHERE username = $1",
    [handle],
  );
  const row = user.rows[0];
  if (!row) throw new Error("approved user missing");
  return { customerId: row.customer_id, userId: row.id, registrationId };
}

/** Signs a user in (real session) and returns the validated session user + their access. */
async function accessOf(userId: string, area: SessionArea) {
  const token = await createUserSession(ws.db, tenant.id, userId, area);
  const user  = await validateUserSession(ws.db, tenant.id, area, token);
  if (!user) return { user: null, access: null, token };
  const disabled = await loadDisabledTenantModules(getControlDb(), tenant.id);
  return { user, access: resolveWorkspaceAccess(user, area, disabled), token };
}

// ---------------------------------------------------------------------------

describe("tenant database mirror and master roles", () => {
  it("permissions is identical to the tenant and customer catalogs", async () => {
    const result = await rt.query(
      `SELECT key, domain::text AS domain, module_key, action, label, description, sort_order
       FROM permissions ORDER BY domain, sort_order, key`,
    );
    // "domain" is ordered as text here (the output alias): customer before tenant.
    const expected = [...permissionsOfDomain("customer"), ...permissionsOfDomain("tenant")].map((permission) => ({
      key: permission.key,
      domain: permission.domain,
      module_key: permission.module,
      action: permission.action,
      label: permission.label,
      description: permission.description,
      sort_order: permission.sortOrder,
    }));
    expect(result.rows).toStrictEqual(expected);
  });

  it("has Master Tenant (key owner, held by the primary admin) and Master Customer", async () => {
    const roles = await rt.query(
      "SELECT key, name, domain::text AS domain, system_key, status::text AS status FROM roles WHERE system_key IS NOT NULL ORDER BY key",
    );
    expect(roles.rows).toStrictEqual([
      { key: "master_customer", name: "Master Customer", domain: "customer", system_key: "master_customer", status: "active" },
      { key: "owner", name: "Master Tenant", domain: "tenant", system_key: "master_tenant", status: "active" },
    ]);
    const admin = await rt.query("SELECT u.is_primary, ur.role_id FROM users u JOIN user_roles ur ON ur.user_id = u.id WHERE u.id = $1", [adminId]);
    expect(admin.rows).toStrictEqual([{ is_primary: true, role_id: masterTenantId }]);
  });
});

describe("effective privileges through the session", () => {
  it("Master Tenant: every tenant privilege and no customer or platform privilege", async () => {
    const { user, access } = await accessOf(adminId, "tenant");
    expect(user).toMatchObject({ isPrimary: true, role: { systemKey: "master_tenant", domain: "tenant", name: "Master Tenant" } });
    expect(access).toMatchObject({ roleState: "active", isMaster: true });
    expect(access?.permissions).toStrictEqual(permissionKeysOfDomain("tenant"));
    expect(access?.can("customer.roles.view" as never)).toBe(false);
    expect(access?.can("platform.tenants.view" as never)).toBe(false);
  });

  it("approval gives the customer's user Master Customer and the primary flag", async () => {
    const { user, access } = await accessOf(customerA.userId, "customer");
    expect(user).toMatchObject({ isPrimary: true, role: { id: masterCustomerId }, customer: { id: customerA.customerId, parentId: null } });
    expect(access?.permissions).toStrictEqual(permissionKeysOfDomain("customer"));
    expect(access?.can("tenant.roles.view" as never)).toBe(false);
  });

  it("a custom tenant role grants exactly its stored privileges; no role keeps the session but grants nothing", async () => {
    await rt.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [staffId, customTenantRoleId]);
    const custom = await accessOf(staffId, "tenant");
    expect(custom.user?.role?.name).toBe("VT Registrations Clerk");
    expect(custom.access?.permissions).toStrictEqual(["tenant.registrations.view", "tenant.users.view"]);

    await rt.query("DELETE FROM user_roles WHERE user_id = $1", [staffId]);
    const none = await accessOf(staffId, "tenant");
    expect(none.user).toMatchObject({ id: staffId, role: null });
    expect(none.access).toMatchObject({ roleState: "missing", permissions: [] });
  });

  it("applies the tenant's module switches from the control plane, master included, never to core modules", async () => {
    await control.query(
      `INSERT INTO tenant_module_settings (tenant_id, module_key, enabled)
       VALUES ($1, 'tenant.registrations', false), ($1, 'tenant.users', false), ($1, 'tenant.appearance', true)`,
      [tenant.id],
    );
    try {
      const { access } = await accessOf(adminId, "tenant");
      expect(access?.isMaster).toBe(true);
      expect(access?.can("tenant.registrations.view")).toBe(false);
      expect(access?.can("tenant.appearance.manage_workspace")).toBe(true);
      // Core module: the switch is ignored.
      expect(access?.can("tenant.users.create")).toBe(true);
    } finally {
      await control.query("DELETE FROM tenant_module_settings WHERE tenant_id = $1", [tenant.id]);
    }
  });

  it("shows a revocation and a disabled role on the next request (written through another connection)", async () => {
    const roleId = await insertRole(rt2, { name: `VT Revocable ${randomBytes(3).toString("hex")}`, domain: "tenant", keys: ["tenant.roles.view", "tenant.users.view"] });
    const userId = await insertUser(rt2, { handle: "revoke" });
    await rt2.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [userId, roleId]);

    const token = await createUserSession(ws.db, tenant.id, userId, "tenant");
    const read  = async () => {
      const user = await validateUserSession(ws.db, tenant.id, "tenant", token);
      if (!user) throw new Error("session refused");
      return resolveWorkspaceAccess(user, "tenant", []);
    };
    expect((await read()).permissions).toStrictEqual(["tenant.roles.view", "tenant.users.view"]);

    await rt2.query(
      "DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = (SELECT id FROM permissions WHERE key = 'tenant.roles.view')",
      [roleId],
    );
    expect((await read()).permissions).toStrictEqual(["tenant.users.view"]);

    await rt2.query("UPDATE roles SET status = 'disabled' WHERE id = $1", [roleId]);
    expect(await read()).toMatchObject({ roleState: "disabled", permissions: [] });
  });

  it("lets a sub-customer use a custom role of its main customer, and refuses it while the main customer is suspended", async () => {
    const { user, access } = await accessOf(subUserId, "customer");
    expect(user?.customer).toMatchObject({ id: subCustomerId, parentId: customerA.customerId });
    expect(access?.permissions).toStrictEqual(["customer.sub_customers.view"]);

    await rt.query("UPDATE customers SET status = 'disabled' WHERE id = $1", [customerA.customerId]);
    try {
      const refused = await accessOf(subUserId, "customer");
      expect(refused.user).toBeNull();
    } finally {
      await rt.query("UPDATE customers SET status = 'active' WHERE id = $1", [customerA.customerId]);
    }
  });

  it("a background check with touch: false never extends the idle timeout", async () => {
    const token     = await createUserSession(ws.db, tenant.id, adminId, "tenant");
    const sessionId = await one(rt, "SELECT id FROM user_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [adminId]);
    await rt.query("UPDATE user_sessions SET last_used_at = now() - interval '2 minutes' WHERE id = $1", [sessionId]);
    const lastUsed = async () =>
      (await rt.query<{ at: Date }>("SELECT last_used_at AS at FROM user_sessions WHERE id = $1", [sessionId])).rows[0]?.at.getTime();

    const before = await lastUsed();
    expect(await validateUserSession(ws.db, tenant.id, "tenant", token, { touch: false })).not.toBeNull();
    expect(await lastUsed()).toBe(before);
    expect(await validateUserSession(ws.db, tenant.id, "tenant", token)).not.toBeNull();
    expect(await lastUsed()).toBeGreaterThan(before ?? 0);
  });

  it("suspending an approved account also suspends its main customer row (and reactivating restores it)", async () => {
    const actor = { type: "tenant_user" as const, id: adminId };
    expect(await setCustomerAccountStatus(ws.db, tenant.id, customerA.registrationId, "suspend", actor, null)).toStrictEqual({ ok: true });
    const status = async () => one(rt, "SELECT status::text AS id FROM customers WHERE id = $1", [customerA.customerId]);
    expect(await status()).toBe("disabled");
    expect((await accessOf(subUserId, "customer")).user).toBeNull();

    expect(await setCustomerAccountStatus(ws.db, tenant.id, customerA.registrationId, "reactivate", actor, null)).toStrictEqual({ ok: true });
    expect(await status()).toBe("active");
    expect((await accessOf(subUserId, "customer")).user).not.toBeNull();
  });
});

describe("database rules (as the runtime login)", () => {
  it("a role stores privileges of its own domain only", async () => {
    await expect(
      rt.query(
        "INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE key = 'customer.roles.view'",
        [customTenantRoleId],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: "role_permissions_domain_match" });
  });

  it("a user holds a role of their own domain and scope only", async () => {
    const someone = await insertUser(rt, { handle: "domain" });
    await expect(rt.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [someone, masterCustomerId])).rejects.toMatchObject({
      code: CHECK_VIOLATION,
      constraint: "user_roles_domain_match",
    });
    const customerUser = await insertUser(rt, { handle: "domainc", customerId: customerBId });
    await expect(rt.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [customerUser, masterTenantId])).rejects.toMatchObject({
      code: CHECK_VIOLATION,
      constraint: "user_roles_domain_match",
    });
    // Customer B's user cannot hold a custom role owned by customer A.
    await expect(
      rt.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [customerBUserId, customCustomerRoleId]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: "user_roles_customer_scope" });
  });

  it("allows one role per user: a second row fails and concurrent assignments leave exactly one", async () => {
    const userId = await insertUser(rt, { handle: "single" });
    await rt.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [userId, masterTenantId]);
    await expect(rt.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [userId, customTenantRoleId])).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
    });

    // Two connections assign different roles at the same time (upsert on user_id).
    const racer = await insertUser(rt, { handle: "race" });
    const upsert = (client: Client, roleId: string) =>
      client.query(
        "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id",
        [racer, roleId],
      );
    await Promise.all([upsert(rt, masterTenantId), upsert(rt2, customTenantRoleId)]);
    const held = await rt.query("SELECT role_id FROM user_roles WHERE user_id = $1", [racer]);
    expect(held.rows).toHaveLength(1);
    expect([masterTenantId, customTenantRoleId]).toContain(held.rows[0]?.role_id);
  });

  it("never deletes a role in use (RESTRICT) nor a master role", async () => {
    await expect(rt.query("DELETE FROM roles WHERE id = $1", [customCustomerRoleId])).rejects.toMatchObject({ code: RESTRICT_VIOLATION });
    await expect(rt.query("DELETE FROM roles WHERE id = $1", [masterCustomerId])).rejects.toMatchObject({ code: RESTRICT_VIOLATION });
  });

  it("keeps customers one level deep", async () => {
    await expect(insertCustomer(rt, "Sub Of Sub", subCustomerId)).rejects.toMatchObject({
      code: CHECK_VIOLATION,
      constraint: "customers_one_level",
    });
    // A main customer with sub-customers cannot become a sub-customer.
    await expect(rt.query("UPDATE customers SET parent_id = $2 WHERE id = $1", [customerA.customerId, customerBId])).rejects.toMatchObject({
      code: CHECK_VIOLATION,
      constraint: "customers_one_level",
    });
  });

  it("keeps a role's scope fixed and custom customer roles owned by a main customer", async () => {
    await expect(rt.query("UPDATE roles SET domain = 'customer' WHERE id = $1", [customTenantRoleId])).rejects.toMatchObject({
      code: CHECK_VIOLATION,
      constraint: "roles_scope_immutable",
    });
    await expect(
      insertRole(rt, { name: "VT Owned By Sub", domain: "customer", owner: subCustomerId, keys: [] }),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: "roles_owner_main_customer" });
    await expect(insertRole(rt, { name: "VT No Owner", domain: "customer", keys: [] })).rejects.toMatchObject({
      code: CHECK_VIOLATION,
      constraint: "roles_owner_customer_check",
    });
    await expect(rt.query("UPDATE roles SET status = 'disabled' WHERE id = $1", [masterTenantId])).rejects.toMatchObject({
      code: CHECK_VIOLATION,
      constraint: "roles_system_active_check",
    });
  });

  it("allows one primary staff account and one primary user per customer", async () => {
    await expect(rt.query("UPDATE users SET is_primary = true WHERE id = $1", [staffId])).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    const second = await insertUser(rt, { handle: "second", customerId: customerA.customerId });
    await expect(rt.query("UPDATE users SET is_primary = true WHERE id = $1", [second])).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    // Another customer may have its own primary user.
    await rt.query("UPDATE users SET is_primary = true WHERE id = $1", [customerBUserId]);
  });
});

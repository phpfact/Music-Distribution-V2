/**
 * The tenant's Customers module (.vibe/memory/customer-management.md), through
 * its Server Actions invoked the way Next.js invokes them:
 *   - every action refuses without its exact tenant.customers.* privilege
 *     (friendly message + authz.denied), also after a revocation, with the
 *     module switched off by the Platform Owner, and for customer sessions;
 *   - Master Tenant creates a customer = main customer + primary user + Master
 *     Customer role, which can log in at once; crafted extra fields change nothing;
 *   - invalid values, taken emails / usernames (accounts, pending and rejected
 *     registrations) and concurrent duplicates are refused under their fields;
 *   - suspend / reactivate switch the customer and its users, end the sessions,
 *     block sub-customers, stay in sync with the Registrations page and refuse
 *     stale changes; sub-customer ids and another tenant's ids are "not found";
 *   - lists, counts and searches only ever show this tenant's main customers.
 *
 * Two REAL provisioned tenants and the scratch control plane; only the request
 * plumbing of Next.js (cookies, headers, redirect, cache) and the Host-header
 * tenant lookup are replaced.
 */
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { permissionKeysOfDomain } from "@/lib/authz/catalog";
import { FORBIDDEN_MESSAGE } from "@/lib/authz/resolver";
import { authenticateWorkspaceUser } from "@/lib/workspace/login";
import { listRegistrations } from "@/lib/workspace/registrations";
import { validateUserSession } from "@/lib/workspace/sessions";
import { createTestUserSession as createUserSession } from "./support/workspace-session";
import { closeAppDatabase } from "./support/app-connections";
import { clearPlatformTables, clearTenantTables, connectToTestDatabase } from "./support/postgres";
import {
  approvedCustomer,
  assignRole,
  auditRows,
  closeRbacTenant,
  insertCustomer,
  insertRole,
  insertUser,
  letters,
  one,
  openRbacTenant,
  STRONG_PASSWORD,
  suffix,
  type RbacTenant,
} from "./support/rbac";
import { TenantResources } from "./support/tenant-resources";

// Provisioning two real tenant databases takes a while.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

// ---------------------------------------------------------------------------
// The request plumbing of Next.js.

const mocks = vi.hoisted(() => ({
  /** Cookie name → value of the "current request". */
  cookies: new Map<string, string>(),
  /** The ready workspace the Host header would resolve to. */
  workspace: null as unknown,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.cookies.has(name) ? { name, value: mocks.cookies.get(name) } : undefined),
  }),
  headers: async () =>
    new Headers({ host: "tenant.test", origin: "http://tenant.test", "sec-fetch-site": "same-origin", "x-forwarded-for": "203.0.113.77" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/workspace/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace/context")>()),
  getWorkspace: async () => mocks.workspace,
}));

// Imported after the mocks.
import {
  createTenantCustomerAction,
  loadTenantCustomerRecordsAction,
  setTenantCustomerStatusAction,
} from "@/app/(workspace)/tenant/customers/actions";
import { tenantDashboardConfig } from "@/app/(workspace)/tenant/navigation";

let control: Client;
let resources: TenantResources;
let tenantA: RbacTenant;
let tenantB: RbacTenant;

beforeAll(async () => {
  control = await connectToTestDatabase();
  await clearPlatformTables(control);
  await clearTenantTables(control);
  resources = await TenantResources.open(control);
  tenantA   = await openRbacTenant("custa", randomUUID());
  tenantB   = await openRbacTenant("custb", randomUUID());
});

beforeEach(() => {
  mocks.cookies.clear();
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
// Helpers

/** Signs a user of tenant `t` in for this "request" (real session, area cookie). */
async function signIn(t: RbacTenant, userId: string, area: "tenant" | "customer"): Promise<string> {
  mocks.workspace = t.ws;
  const token = await createUserSession(t.ws.db, t.tenant.id, userId, area);
  mocks.cookies.set(area === "tenant" ? "md_tenant_session" : "md_customer_session", token);
  return token;
}

/** A staff user of tenant `t` holding a new custom tenant role with exactly these keys. */
async function staffWith(t: RbacTenant, keys: string[]): Promise<{ userId: string; roleId: string }> {
  const roleId = await insertRole(t.rt, { name: `VT Cu ${suffix()}`, domain: "tenant", keys });
  const userId = await insertUser(t.rt, { handle: "cu" });
  await assignRole(t.rt, userId, roleId);
  return { userId, roleId };
}

/** A valid "Add customer" form (plus any extra or overriding entries). */
function customerForm(extra: Record<string, string | string[]> = {}): { data: FormData; username: string; email: string; fullName: string } {
  const username = `vt-new-${suffix()}`;
  const email    = `${username}@example.com`;
  const fullName = `Cust ${letters()} Records`;
  const values: Record<string, string | string[]> = {
    fullName,
    accountType: "label",
    username,
    email,
    password: STRONG_PASSWORD,
    confirmPassword: STRONG_PASSWORD,
    ...extra,
  };
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const entry of Array.isArray(value) ? value : [value]) data.append(key, entry);
  }
  return { data, username, email, fullName };
}

/** Runs an action that should redirect; returns the redirect target. */
async function redirected(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const match = /^NEXT_REDIRECT (.+)$/.exec((error as Error).message);
    if (match?.[1]) return match[1];
    throw error;
  }
  throw new Error("the action did not redirect");
}

/** The message a refusal carries, whatever the action's result shape is. */
function refusalMessage(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const record = result as Record<string, unknown>;
  for (const key of ["error", "formMessage"]) if (typeof record[key] === "string") return record[key] as string;
  return undefined;
}

/** How many authz.denied rows exist for this actor, privilege and tenant. */
async function denials(actorId: string, permission: string, tenantId: string): Promise<number> {
  const result = await control.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM audit_events WHERE action = 'authz.denied' AND actor_id = $1 AND target_id = $2 AND tenant_id = $3",
    [actorId, permission, tenantId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** How many users of tenant `t` have this username. */
async function usersNamed(t: RbacTenant, username: string): Promise<number> {
  return Number(await one(t.rt, "SELECT count(*)::text AS id FROM users WHERE username = $1", [username]));
}

/** How many customers tenant `t` has (main and sub). */
async function customerCount(t: RbacTenant): Promise<number> {
  return Number(await one(t.rt, "SELECT count(*)::text AS id FROM customers"));
}

/** The stored state of a customer created by username: customer row, user, role. */
async function createdAccount(t: RbacTenant, username: string) {
  const result = await t.rt.query<{
    user_id: string;
    customer_id: string;
    is_primary: boolean;
    user_status: string;
    customer_status: string;
    parent_id: string | null;
    type: string;
    name: string;
    role_key: string | null;
    roles: string;
  }>(
    `SELECT u.id AS user_id, u.customer_id, u.is_primary, u.status::text AS user_status,
            c.status::text AS customer_status, c.parent_id, c.type::text AS type, c.name,
            r.system_key AS role_key,
            (SELECT count(*)::text FROM user_roles x WHERE x.user_id = u.id) AS roles
       FROM users u
       JOIN customers c ON c.id = u.customer_id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.username = $1`,
    [username],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`no created account ${username}`);
  return row;
}

/** Creates a customer through the action as tenant `t`'s Master Tenant admin; returns its ids. */
async function createAsMaster(t: RbacTenant): Promise<{ customerId: string; userId: string; username: string; fullName: string }> {
  await signIn(t, t.adminId, "tenant");
  const { data, username, fullName } = customerForm();
  expect(await redirected(() => createTenantCustomerAction({ status: "idle" }, data))).toBe("/tenant/customers?notice=customer-created");
  const account = await createdAccount(t, username);
  return { customerId: account.customer_id, userId: account.user_id, username, fullName };
}

// ---------------------------------------------------------------------------
// Authorization

type ActionCase = [name: string, permission: string, run: () => Promise<unknown>];

const ACTIONS: ActionCase[] = [
  ["loadTenantCustomerRecordsAction", "tenant.customers.view", () => loadTenantCustomerRecordsAction("all", 1)],
  ["createTenantCustomerAction", "tenant.customers.create", () => createTenantCustomerAction({ status: "idle" }, customerForm().data)],
  ["setTenantCustomerStatusAction", "tenant.customers.suspend", () => setTenantCustomerStatusAction(randomUUID(), "suspend")],
];

describe("every Customers action needs its exact privilege", () => {
  it.each(ACTIONS)("%s refuses without %s and audits authz.denied", async (_name, permission, run) => {
    const { userId } = await staffWith(tenantA, permissionKeysOfDomain("tenant").filter((key) => key !== permission));
    await signIn(tenantA, userId, "tenant");
    const before = await customerCount(tenantA);

    expect(refusalMessage(await run())).toBe(FORBIDDEN_MESSAGE);
    expect(await denials(userId, permission, tenantA.tenant.id)).toBe(1);
    expect(await customerCount(tenantA)).toBe(before);
  });

  it("a revoked privilege refuses the very next call (no logout needed)", async () => {
    const { userId, roleId } = await staffWith(tenantA, ["tenant.customers.view", "tenant.customers.create"]);
    await signIn(tenantA, userId, "tenant");
    expect(await loadTenantCustomerRecordsAction("all", 1)).toMatchObject({ ok: true });

    // Revoke "create" on the role: the next create is refused, view still works.
    await tenantA.rt.query(
      "DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = (SELECT id FROM permissions WHERE key = 'tenant.customers.create')",
      [roleId],
    );
    const { data, username } = customerForm();
    expect(refusalMessage(await createTenantCustomerAction({ status: "idle" }, data))).toBe(FORBIDDEN_MESSAGE);
    expect(await usersNamed(tenantA, username)).toBe(0);

    // Disabling the whole role ends every protected call.
    await tenantA.rt.query("UPDATE roles SET status = 'disabled' WHERE id = $1", [roleId]);
    expect(refusalMessage(await loadTenantCustomerRecordsAction("all", 1))).toBeDefined();
  });

  it("the Platform Owner switching tenant.customers off refuses even Master Tenant, only for that tenant", async () => {
    await control.query("INSERT INTO tenant_module_settings (tenant_id, module_key, enabled) VALUES ($1, 'tenant.customers', false)", [tenantA.tenant.id]);
    try {
      await signIn(tenantA, tenantA.adminId, "tenant");
      const { data, username } = customerForm();
      expect(refusalMessage(await createTenantCustomerAction({ status: "idle" }, data))).toBeDefined();
      expect(await usersNamed(tenantA, username)).toBe(0);

      // Tenant B keeps the module.
      await signIn(tenantB, tenantB.adminId, "tenant");
      expect(await loadTenantCustomerRecordsAction("all", 1)).toMatchObject({ ok: true });
    } finally {
      await control.query("DELETE FROM tenant_module_settings WHERE tenant_id = $1", [tenantA.tenant.id]);
    }
  });

  it("customer sessions and visitors never reach the tenant actions (redirect to the login page)", async () => {
    const main = await approvedCustomer(tenantA, `Cu Main ${letters()}`);
    await signIn(tenantA, main.userId, "customer");
    for (const [, , run] of ACTIONS) {
      expect(await redirected(run)).toBe("/login");
    }
    mocks.cookies.clear();
    for (const [, , run] of ACTIONS) {
      expect(await redirected(run)).toBe("/login");
    }
  });

  it("navigation shows Customers only with tenant.customers.view (the placeholder is gone)", () => {
    const user  = { name: "Vt", username: "vt", email: "vt@example.com", role: { name: "Clerk" } };
    const grant = (keys: string[]) => ({ roleState: "active", can: (key: string) => keys.includes(key) });

    const without = tenantDashboardConfig("T", user, grant([]));
    const business = (config: typeof without) => config.navGroups.find((group) => group.label === "Business")?.items ?? [];
    expect(business(without).map((item) => item.href)).not.toContain("/tenant/customers");

    const withView = tenantDashboardConfig("T", user, grant(["tenant.customers.view"]));
    expect(business(withView)[0]).toMatchObject({ title: "Customers", href: "/tenant/customers" });
    expect(business(withView)[0]?.soon).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Create

describe("creating a customer", () => {
  it("Master Tenant creates a main customer with a primary Master Customer account that logs in at once", async () => {
    const created = await createAsMaster(tenantA);
    const account = await createdAccount(tenantA, created.username);

    // Step 1: the stored shape — main customer, primary active user, exactly one role.
    expect(account).toMatchObject({
      is_primary: true,
      user_status: "active",
      customer_status: "active",
      parent_id: null,
      type: "label",
      name: created.fullName,
      role_key: "master_customer",
      roles: "1",
    });

    // Step 2: audited after the commit, without personal data.
    const audit = await auditRows(control, "customer_account.created", tenantA.adminId);
    expect(audit.at(-1)).toMatchObject({ target_id: created.customerId, metadata: { accountType: "label" } });
    expect(JSON.stringify(audit.at(-1)?.metadata)).not.toContain(created.username);

    // Step 3: the customer signs in with the password the tenant chose → customer area.
    const login = await authenticateWorkspaceUser(tenantA.ws, { identifier: created.username, password: STRONG_PASSWORD }, "203.0.113.78");
    expect(login).toMatchObject({ ok: true, destination: "customer" });
    const hash = await one(tenantA.rt, "SELECT password_hash AS id FROM users WHERE id = $1", [created.userId]);
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("ignores crafted extra fields: role, primary flag, parent, status and tenant", async () => {
    await signIn(tenantA, tenantA.adminId, "tenant");
    const other   = await approvedCustomer(tenantA, `Cu Other ${letters()}`);
    const tenantRole = await insertRole(tenantA.rt, { name: `VT Cu Tr ${suffix()}`, domain: "tenant", keys: ["tenant.users.view"] });
    const { data, username } = customerForm({
      roleId: [tenantA.masterTenantId, tenantRole],
      isPrimary: "false",
      parentId: other.customerId,
      status: "disabled",
      tenantId: tenantB.tenant.id,
    });
    expect(await redirected(() => createTenantCustomerAction({ status: "idle" }, data))).toBe("/tenant/customers?notice=customer-created");

    const account = await createdAccount(tenantA, username);
    expect(account).toMatchObject({ is_primary: true, parent_id: null, user_status: "active", role_key: "master_customer", roles: "1" });
    expect(await usersNamed(tenantB, username)).toBe(0);
  });

  it("refuses invalid values with an error under each field; nothing is written", async () => {
    await signIn(tenantA, tenantA.adminId, "tenant");
    const before = await customerCount(tenantA);
    const cases: [Record<string, string>, string][] = [
      [{ fullName: "   " }, "fullName"],
      [{ fullName: "Asha 123" }, "fullName"],
      [{ accountType: "admin" }, "accountType"],
      [{ username: "Bad Name!" }, "username"],
      [{ email: "not-an-email" }, "email"],
      [{ password: "short", confirmPassword: "short" }, "password"],
      [{ confirmPassword: "Different-Pass-2026!" }, "confirmPassword"],
    ];
    for (const [override, field] of cases) {
      const result = await createTenantCustomerAction({ status: "idle" }, customerForm(override).data);
      expect(result, JSON.stringify(override)).toMatchObject({ status: "error", fieldErrors: { [field]: expect.any(String) } });
    }
    // Missing fields entirely (a crafted request).
    expect(await createTenantCustomerAction({ status: "idle" }, new FormData())).toMatchObject({
      status: "error",
      fieldErrors: { fullName: expect.any(String), accountType: expect.any(String), username: expect.any(String), email: expect.any(String) },
    });
    expect(await customerCount(tenantA)).toBe(before);
  });

  it("refuses an email or username used by an account, a pending or a rejected registration", async () => {
    await signIn(tenantA, tenantA.adminId, "tenant");
    const staffUsername = await one(tenantA.rt, "SELECT username AS id FROM users WHERE id = $1", [tenantA.adminId]);
    const pending  = `vt-pend-${suffix()}`;
    const rejected = `vt-rej-${suffix()}`;
    await tenantA.rt.query(
      `INSERT INTO customer_registrations (id, full_name, email, username, password_hash, account_type, status, rejection_reason, updated_at)
       VALUES (gen_random_uuid(), 'Pending Person', $1, $2, 'h', 'artist', 'pending', NULL, now()),
              (gen_random_uuid(), 'Rejected Person', $3, $4, 'h', 'artist', 'rejected', 'Not a fit', now())`,
      [`${pending}@example.com`, pending, `${rejected}@example.com`, rejected],
    );

    const cases: [Record<string, string>, string][] = [
      [{ username: staffUsername }, "username"],
      [{ username: pending }, "username"],
      [{ email: `${pending}@example.com` }, "email"],
      [{ username: rejected }, "username"],
      [{ email: `${rejected}@example.com` }, "email"],
      // Case and spaces do not make a new identity.
      [{ email: `  ${pending.toUpperCase()}@EXAMPLE.COM ` }, "email"],
    ];
    for (const [override, field] of cases) {
      const { data, username } = customerForm(override);
      const result = await createTenantCustomerAction({ status: "idle" }, data);
      expect(result, JSON.stringify(override)).toMatchObject({ status: "error", fieldErrors: { [field]: expect.any(String) } });
      if (!override.username) expect(await usersNamed(tenantA, username)).toBe(0);
    }
  });

  it("two concurrent creations with the same username leave exactly one account", async () => {
    await signIn(tenantA, tenantA.adminId, "tenant");
    const username = `vt-race-${suffix()}`;
    const first    = customerForm({ username, email: `${username}-1@example.com` });
    const second   = customerForm({ username, email: `${username}-2@example.com` });

    const settle = (data: FormData) =>
      createTenantCustomerAction({ status: "idle" }, data).then(
        (state) => ({ kind: "state" as const, state }),
        (error: Error) => ({ kind: "thrown" as const, message: error.message }),
      );
    const results = await Promise.all([settle(first.data), settle(second.data)]);

    expect(results.filter((result) => result.kind === "thrown" && result.message.startsWith("NEXT_REDIRECT"))).toHaveLength(1);
    expect(results.filter((result) => result.kind === "state")).toMatchObject([
      { state: { status: "error", fieldErrors: { username: expect.any(String) } } },
    ]);
    expect(await usersNamed(tenantA, username)).toBe(1);
  });

  it("the same username can exist in another tenant (identities are per tenant)", async () => {
    const created = await createAsMaster(tenantA);
    await signIn(tenantB, tenantB.adminId, "tenant");
    const { data } = customerForm({ username: created.username });
    expect(await redirected(() => createTenantCustomerAction({ status: "idle" }, data))).toBe("/tenant/customers?notice=customer-created");
    expect(await usersNamed(tenantB, created.username)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Suspend / reactivate

describe("suspending and reactivating a customer", () => {
  it("suspend ends the sessions, blocks sub-customers; reactivate restores; stale changes are refused", async () => {
    const created = await createAsMaster(tenantA);
    const subCustomer = await insertCustomer(tenantA.rt, `Cu Sub ${letters()}`, created.customerId);
    const subUser     = await insertUser(tenantA.rt, { handle: "cusub", customerId: subCustomer });
    const subRole     = await insertRole(tenantA.rt, { name: `VT Cu Sr ${suffix()}`, domain: "customer", owner: created.customerId, keys: ["customer.roles.view"] });
    await assignRole(tenantA.rt, subUser, subRole);
    const customerToken = await createUserSession(tenantA.ws.db, tenantA.tenant.id, created.userId, "customer");
    const subToken      = await createUserSession(tenantA.ws.db, tenantA.tenant.id, subUser, "customer");

    // Step 1: suspend (as Master Tenant).
    await signIn(tenantA, tenantA.adminId, "tenant");
    expect(await setTenantCustomerStatusAction(created.customerId, "suspend")).toMatchObject({ ok: true });
    expect(await createdAccount(tenantA, created.username)).toMatchObject({ customer_status: "disabled", user_status: "disabled" });
    expect(await one(tenantA.rt, "SELECT count(*)::text AS id FROM user_sessions WHERE user_id = $1", [created.userId])).toBe("0");
    expect(await validateUserSession(tenantA.ws.db, tenantA.tenant.id, "customer", customerToken)).toBeNull();
    expect(await validateUserSession(tenantA.ws.db, tenantA.tenant.id, "customer", subToken)).toBeNull();
    expect(await auditRows(control, "customer_account.suspended", tenantA.adminId)).toContainEqual({
      target_id: created.customerId,
      metadata: { via: "customers" },
    });

    // Step 2: a second suspend (stale page) changes nothing.
    expect(await setTenantCustomerStatusAction(created.customerId, "suspend")).toMatchObject({ ok: false, error: expect.stringContaining("already suspended") });

    // Step 3: reactivate: the customer can log in again; the sub-customer's main customer is active again.
    expect(await setTenantCustomerStatusAction(created.customerId, "reactivate")).toMatchObject({ ok: true });
    expect(await createdAccount(tenantA, created.username)).toMatchObject({ customer_status: "active", user_status: "active" });
    expect(await validateUserSession(tenantA.ws.db, tenantA.tenant.id, "customer", subToken, { touch: false })).not.toBeNull();
    expect(await setTenantCustomerStatusAction(created.customerId, "reactivate")).toMatchObject({ ok: false, error: expect.stringContaining("already active") });
  });

  it("keeps the Registrations page in sync for a signed-up customer", async () => {
    const signedUp = await approvedCustomer(tenantA, `Cu Signup ${letters()}`);
    await signIn(tenantA, tenantA.adminId, "tenant");
    expect(await setTenantCustomerStatusAction(signedUp.customerId, "suspend")).toMatchObject({ ok: true });

    const page = await listRegistrations(tenantA.ws.db, { q: "", status: "suspended", page: 1 });
    expect(page.rows.map((row) => row.id)).toContain(signedUp.registrationId);
    expect(await setTenantCustomerStatusAction(signedUp.customerId, "reactivate")).toMatchObject({ ok: true });
  });

  it("refuses sub-customer ids, another tenant's customers, unknown, malformed ids and unknown changes", async () => {
    const created     = await createAsMaster(tenantA);
    const subCustomer = await insertCustomer(tenantA.rt, `Cu Sub ${letters()}`, created.customerId);
    const foreign     = await createAsMaster(tenantB);

    await signIn(tenantA, tenantA.adminId, "tenant");
    for (const id of [subCustomer, foreign.customerId, randomUUID(), "not-a-uuid", "", null, 42, ["x"]]) {
      expect(await setTenantCustomerStatusAction(id, "suspend"), JSON.stringify(id)).toMatchObject({ ok: false, error: expect.stringContaining("no longer exists") });
    }
    for (const change of ["delete", "", null, ["suspend"]]) {
      expect(await setTenantCustomerStatusAction(created.customerId, change), JSON.stringify(change)).toMatchObject({ ok: false });
    }

    // Nothing changed: the sub-customer and tenant B's customer stay active.
    expect(await one(tenantA.rt, "SELECT status::text AS id FROM customers WHERE id = $1", [subCustomer])).toBe("active");
    expect(await one(tenantB.rt, "SELECT status::text AS id FROM customers WHERE id = $1", [foreign.customerId])).toBe("active");
    expect(await createdAccount(tenantA, created.username)).toMatchObject({ customer_status: "active" });
  });
});

// ---------------------------------------------------------------------------
// Lists and counts

describe("lists and counts", () => {
  it("show only this tenant's main customers, with source, account fields and correct counts", async () => {
    const created  = await createAsMaster(tenantA);
    const signedUp = await approvedCustomer(tenantA, `Cu Listed ${letters()}`);
    const sub      = await insertCustomer(tenantA.rt, `Cu Hidden Sub ${letters()}`, created.customerId);
    const foreign  = await createAsMaster(tenantB);

    await signIn(tenantA, tenantA.adminId, "tenant");
    const all = await loadTenantCustomerRecordsAction("all", 1);
    if (!all.ok) throw new Error(all.error);
    const ids = all.page.rows.map((row) => row.id);
    expect(ids).toContain(created.customerId);
    expect(ids).toContain(signedUp.customerId);
    expect(ids).not.toContain(sub);
    expect(ids).not.toContain(foreign.customerId);

    // Source, account fields and never a password hash.
    const mine = all.page.rows.find((row) => row.id === created.customerId);
    expect(mine).toMatchObject({ source: "tenant", username: created.username, status: "active" });
    expect(all.page.rows.find((row) => row.id === signedUp.customerId)).toMatchObject({ source: "signup" });
    expect(JSON.stringify(all.page)).not.toContain("argon2");

    // Counts agree with the database (main customers of this tenant only).
    const mainActive    = Number(await one(tenantA.rt, "SELECT count(*)::text AS id FROM customers WHERE parent_id IS NULL AND status = 'active'"));
    const mainSuspended = Number(await one(tenantA.rt, "SELECT count(*)::text AS id FROM customers WHERE parent_id IS NULL AND status = 'disabled'"));
    const active        = await loadTenantCustomerRecordsAction("active", 1);
    const suspended     = await loadTenantCustomerRecordsAction("disabled", 1);
    expect(active).toMatchObject({ ok: true, page: { total: mainActive } });
    expect(suspended).toMatchObject({ ok: true, page: { total: mainSuspended } });
    expect(all.page.total).toBe(mainActive + mainSuspended);

    // Unknown filters are refused; a crafted page number falls back to page 1.
    expect(await loadTenantCustomerRecordsAction("pending", 1)).toMatchObject({ ok: false });
    expect(await loadTenantCustomerRecordsAction("all", -5)).toMatchObject({ ok: true, page: { page: 1 } });
  });
});

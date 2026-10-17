/**
 * The Tenant and Customer RBAC Server Actions, invoked the way Next.js invokes
 * them (.vibe/memory/role-privilege-management.md, "Technical Notes" →
 * "RBAC pages (all panels)"): every action refuses without its exact privilege
 * (friendly message + `authz.denied`); Master Tenant creates roles and
 * Sub-Tenants with exactly one role; wrong, foreign or several role ids and
 * foreign-domain privileges are refused (escalations audited); Master
 * Customer creates Sub-Customers under its main customer; a sub-customer never
 * creates under itself and never reaches another main customer's records.
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
import { createUserSession } from "@/lib/workspace/sessions";
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
  openRbacTenant,
  STRONG_PASSWORD,
  suffix,
  workspaceRoleKeys,
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
    new Headers({ host: "tenant.test", origin: "http://tenant.test", "sec-fetch-site": "same-origin", "x-forwarded-for": "203.0.113.88" }),
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
  createTenantRoleAction,
  deleteTenantRoleAction,
  loadTenantAssignedUserRecordsAction,
  loadTenantRolePrivilegesAction,
  loadTenantRoleRecordsAction,
  loadTenantRoleUsersAction,
  setTenantRoleStatusAction,
  updateTenantRoleAction,
} from "@/app/(workspace)/tenant/roles/actions";
import {
  createSubTenantAction,
  loadSubTenantRecordsAction,
  setSubTenantStatusAction,
  updateSubTenantAction,
} from "@/app/(workspace)/tenant/users/actions";
import {
  createCustomerRoleAction,
  deleteCustomerRoleAction,
  loadCustomerAssignedUserRecordsAction,
  loadCustomerRolePrivilegesAction,
  loadCustomerRoleRecordsAction,
  loadCustomerRoleUsersAction,
  setCustomerRoleStatusAction,
  updateCustomerRoleAction,
} from "@/app/(workspace)/customer/(portal)/roles/actions";
import {
  createSubCustomerAction,
  loadSubCustomerRecordsAction,
  setSubCustomerStatusAction,
  updateSubCustomerAction,
} from "@/app/(workspace)/customer/(portal)/sub-customers/actions";
import CustomerRoleDetailsPage from "@/app/(workspace)/customer/(portal)/roles/[id]/page";

let control: Client;
let resources: TenantResources;
let tenantA: RbacTenant;
let tenantB: RbacTenant;

beforeAll(async () => {
  control = await connectToTestDatabase();
  await clearPlatformTables(control);
  await clearTenantTables(control);
  resources = await TenantResources.open(control);
  tenantA   = await openRbacTenant("rbacwa", randomUUID());
  tenantB   = await openRbacTenant("rbacwb", randomUUID());
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
async function signIn(t: RbacTenant, userId: string, area: "tenant" | "customer"): Promise<void> {
  mocks.workspace = t.ws;
  const token = await createUserSession(t.ws.db, t.tenant.id, userId, area);
  mocks.cookies.set(area === "tenant" ? "md_tenant_session" : "md_customer_session", token);
}

/** A staff user of tenant `t` holding a new custom tenant role with exactly these keys. */
async function staffWith(t: RbacTenant, keys: string[]): Promise<string> {
  const role = await insertRole(t.rt, { name: `VT Wa ${suffix()}`, domain: "tenant", keys });
  const user = await insertUser(t.rt, { handle: "wa" });
  await assignRole(t.rt, user, role);
  return user;
}

/** A sub-customer user under `mainCustomerId` holding a new customer role (owned by the main customer). */
async function subCustomerWith(t: RbacTenant, mainCustomerId: string, keys: string[]): Promise<{ userId: string; customerId: string; roleId: string }> {
  const roleId     = await insertRole(t.rt, { name: `VT Wc ${suffix()}`, domain: "customer", owner: mainCustomerId, keys });
  const customerId = await insertCustomer(t.rt, `Wc Sub ${letters()}`, mainCustomerId);
  const userId     = await insertUser(t.rt, { handle: "wc", customerId });
  await assignRole(t.rt, userId, roleId);
  return { userId, customerId, roleId };
}

/** A FormData from plain values (arrays become repeated entries). */
function form(values: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const entry of Array.isArray(value) ? value : [value]) data.append(key, entry);
  }
  return data;
}

/** A valid Sub-Tenant / Sub-Customer create form with the given role ids. */
function subUserForm(roleIds: string[], extra: Record<string, string> = {}): { data: FormData; username: string } {
  const username = `vt-wf-${suffix()}`;
  const data = form({
    fullName: `Wf User ${letters()}`,
    username,
    email: `${username}@example.com`,
    password: STRONG_PASSWORD,
    confirmPassword: STRONG_PASSWORD,
    roleId: roleIds,
    ...extra,
  });
  return { data, username };
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

/** How many users of tenant `t` have this username. */
async function usersNamed(t: RbacTenant, username: string): Promise<number> {
  const result = await t.rt.query<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE username = $1", [username]);
  return Number(result.rows[0]?.count ?? 0);
}

/** How many authz.denied rows exist for this actor, privilege and tenant. */
async function denials(actorId: string, permission: string, tenantId: string): Promise<number> {
  const result = await control.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM audit_events WHERE action = 'authz.denied' AND actor_id = $1 AND target_id = $2 AND tenant_id = $3",
    [actorId, permission, tenantId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** The message a refusal carries, whatever the action's result shape is. */
function refusalMessage(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const record = result as Record<string, unknown>;
  for (const key of ["error", "formMessage"]) if (typeof record[key] === "string") return record[key] as string;
  return undefined;
}

// ---------------------------------------------------------------------------
// Every action and its exact privilege.

type ActionCase = [name: string, permission: string, run: () => Promise<unknown>];

const someId = randomUUID();
const TENANT_ACTIONS: ActionCase[] = [
  ["loadTenantRolePrivilegesAction", "tenant.roles.view", () => loadTenantRolePrivilegesAction(someId)],
  ["loadTenantRoleUsersAction", "tenant.roles.view", () => loadTenantRoleUsersAction(someId, 1)],
  ["loadTenantRoleRecordsAction", "tenant.roles.view", () => loadTenantRoleRecordsAction("all", 1)],
  ["loadTenantAssignedUserRecordsAction", "tenant.roles.view", () => loadTenantAssignedUserRecordsAction(1)],
  ["createTenantRoleAction", "tenant.roles.create", () => createTenantRoleAction({ status: "idle" }, new FormData())],
  ["updateTenantRoleAction", "tenant.roles.edit", () => updateTenantRoleAction(someId, { status: "idle" }, new FormData())],
  ["setTenantRoleStatusAction", "tenant.roles.edit", () => setTenantRoleStatusAction(someId, "disabled")],
  ["deleteTenantRoleAction", "tenant.roles.delete", () => deleteTenantRoleAction(someId, null)],
  ["loadSubTenantRecordsAction", "tenant.users.view", () => loadSubTenantRecordsAction("all", 1)],
  ["createSubTenantAction", "tenant.users.create", () => createSubTenantAction({ status: "idle" }, new FormData())],
  ["updateSubTenantAction", "tenant.users.edit", () => updateSubTenantAction(someId, { status: "idle" }, new FormData())],
  ["setSubTenantStatusAction", "tenant.users.suspend", () => setSubTenantStatusAction(someId, "suspend")],
];
const CUSTOMER_ACTIONS: ActionCase[] = [
  ["loadCustomerRolePrivilegesAction", "customer.roles.view", () => loadCustomerRolePrivilegesAction(someId)],
  ["loadCustomerRoleUsersAction", "customer.roles.view", () => loadCustomerRoleUsersAction(someId, 1)],
  ["loadCustomerRoleRecordsAction", "customer.roles.view", () => loadCustomerRoleRecordsAction("all", 1)],
  ["loadCustomerAssignedUserRecordsAction", "customer.roles.view", () => loadCustomerAssignedUserRecordsAction(1)],
  ["createCustomerRoleAction", "customer.roles.create", () => createCustomerRoleAction({ status: "idle" }, new FormData())],
  ["updateCustomerRoleAction", "customer.roles.edit", () => updateCustomerRoleAction(someId, { status: "idle" }, new FormData())],
  ["setCustomerRoleStatusAction", "customer.roles.edit", () => setCustomerRoleStatusAction(someId, "disabled")],
  ["deleteCustomerRoleAction", "customer.roles.delete", () => deleteCustomerRoleAction(someId, null)],
  ["loadSubCustomerRecordsAction", "customer.sub_customers.view", () => loadSubCustomerRecordsAction("all", 1)],
  ["createSubCustomerAction", "customer.sub_customers.create", () => createSubCustomerAction({ status: "idle" }, new FormData())],
  ["updateSubCustomerAction", "customer.sub_customers.edit", () => updateSubCustomerAction(someId, { status: "idle" }, new FormData())],
  ["setSubCustomerStatusAction", "customer.sub_customers.suspend", () => setSubCustomerStatusAction(someId, "suspend")],
];

describe("every workspace RBAC action needs its exact privilege", () => {
  it.each(TENANT_ACTIONS)("%s refuses without %s and audits authz.denied", async (_name, permission, run) => {
    const userId = await staffWith(tenantA, permissionKeysOfDomain("tenant").filter((key) => key !== permission));
    await signIn(tenantA, userId, "tenant");

    expect(refusalMessage(await run())).toBe(FORBIDDEN_MESSAGE);
    expect(await denials(userId, permission, tenantA.tenant.id)).toBe(1);
  });

  it.each(CUSTOMER_ACTIONS)("%s refuses without %s and audits authz.denied", async (_name, permission, run) => {
    const main = await approvedCustomer(tenantA, `Deny Label ${letters()}`);
    const sub  = await subCustomerWith(tenantA, main.customerId, permissionKeysOfDomain("customer").filter((key) => key !== permission));
    await signIn(tenantA, sub.userId, "customer");

    expect(refusalMessage(await run())).toBe(FORBIDDEN_MESSAGE);
    expect(await denials(sub.userId, permission, tenantA.tenant.id)).toBe(1);
  });
});

describe("tenant roles and Sub-Tenants", () => {
  it("Master Tenant creates a role and a Sub-Tenant with exactly that one role", async () => {
    await signIn(tenantA, tenantA.adminId, "tenant");

    // The role: redirect to its details page with the notice; exactly the submitted keys stored.
    const name   = `Support ${letters()}`;
    const target = await redirected(() =>
      createTenantRoleAction({ status: "idle" }, form({ name, description: "Help desk", status: "active", privileges: ["tenant.users.view", "tenant.registrations.view"] })),
    );
    const match = /^\/tenant\/roles\/([0-9a-f-]{36})\?notice=role-created$/.exec(target);
    expect(match).not.toBeNull();
    const roleId = match?.[1] ?? "";
    expect(await workspaceRoleKeys(tenantA.rt, roleId)).toStrictEqual(["tenant.registrations.view", "tenant.users.view"]);

    // The Sub-Tenant: redirect to the list; one user_roles row with that role.
    const { data, username } = subUserForm([roleId]);
    expect(await redirected(() => createSubTenantAction({ status: "idle" }, data))).toBe("/tenant/users?notice=user-created");
    const roles = await tenantA.rt.query<{ role_id: string }>(
      "SELECT ur.role_id FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE u.username = $1",
      [username],
    );
    expect(roles.rows.map((row) => row.role_id)).toStrictEqual([roleId]);
  });

  it("refuses zero, several, customer-domain and foreign-tenant role ids; nothing is created", async () => {
    await signIn(tenantA, tenantA.adminId, "tenant");
    const own     = await insertRole(tenantA.rt, { name: `VT Own ${suffix()}`, domain: "tenant", keys: ["tenant.users.view"] });
    const foreign = await insertRole(tenantB.rt, { name: `VT Foreign ${suffix()}`, domain: "tenant", keys: ["tenant.users.view"] });

    for (const roleIds of [[], [own, tenantA.masterTenantId], [tenantA.masterCustomerId], [foreign], [tenantB.masterTenantId]]) {
      const { data, username } = subUserForm(roleIds);
      const result = await createSubTenantAction({ status: "idle" }, data);
      expect(result, JSON.stringify(roleIds)).toMatchObject({ status: "error", fieldErrors: { roleId: expect.any(String) } });
      expect(await usersNamed(tenantA, username)).toBe(0);
    }
  });

  it("refuses a tenant role with a platform or customer privilege and audits the escalation", async () => {
    const userId = await staffWith(tenantA, ["tenant.roles.view", "tenant.roles.create", "tenant.users.view"]);
    await signIn(tenantA, userId, "tenant");
    const before = (await auditRows(control, "authz.escalation_blocked", userId)).length;

    for (const foreignKey of ["platform.tenants.view", "customer.roles.view"]) {
      const name   = `Escalate ${letters()}`;
      const result = await createTenantRoleAction({ status: "idle" }, form({ name, description: "", status: "active", privileges: ["tenant.users.view", foreignKey] }));
      expect(result, foreignKey).toMatchObject({ status: "error", fieldErrors: { privileges: expect.any(String) } });
      const stored = await tenantA.rt.query("SELECT 1 FROM roles WHERE name = $1", [name]);
      expect(stored.rowCount).toBe(0);
    }
    expect((await auditRows(control, "authz.escalation_blocked", userId)).length).toBe(before + 2);
  });

  it("disables a role with the intended status and refuses a stale or missing one", async () => {
    await signIn(tenantA, tenantA.adminId, "tenant");
    const role = await insertRole(tenantA.rt, { name: `VT Toggle ${suffix()}`, domain: "tenant", keys: ["tenant.users.view"] });

    expect(await setTenantRoleStatusAction(role, "disabled")).toMatchObject({ ok: true });
    // The page was rendered before the change: the same intended status again is refused, never flipped back.
    expect(await setTenantRoleStatusAction(role, "disabled")).toMatchObject({ ok: false });
    // A crafted request without a valid intended status is refused as well.
    expect(await setTenantRoleStatusAction(role, undefined as unknown as "active")).toMatchObject({ ok: false });
  });
});

describe("customer roles and Sub-Customers", () => {
  it("Master Customer creates a Sub-Customer: customer row under the main customer, its user and one role", async () => {
    const x = await approvedCustomer(tenantA, `Xena Wa ${letters()}`);
    await signIn(tenantA, x.userId, "customer");

    // A custom role of X through the action.
    const target = await redirected(() =>
      createCustomerRoleAction({ status: "idle" }, form({ name: `Team ${letters()}`, description: "", status: "active", privileges: ["customer.sub_customers.view", "customer.sub_customers.create"] })),
    );
    const roleId = /^\/customer\/roles\/([0-9a-f-]{36})\?notice=role-created$/.exec(target)?.[1] ?? "";
    expect(roleId).not.toBe("");

    const { data, username } = subUserForm([roleId], { accountType: "artist" });
    expect(await redirected(() => createSubCustomerAction({ status: "idle" }, data))).toBe("/customer/sub-customers?notice=user-created");
    const row = await tenantA.rt.query<{ parent_id: string; type: string; role_id: string }>(
      `SELECT c.parent_id::text AS parent_id, c.type::text AS type, ur.role_id::text AS role_id
       FROM users u JOIN customers c ON c.id = u.customer_id JOIN user_roles ur ON ur.user_id = u.id WHERE u.username = $1`,
      [username],
    );
    expect(row.rows).toStrictEqual([{ parent_id: x.customerId, type: "artist", role_id: roleId }]);
  });

  it("a sub-customer creates under the MAIN customer only and never reaches another main customer", async () => {
    const x   = await approvedCustomer(tenantA, `Xavi Wa ${letters()}`);
    const y   = await approvedCustomer(tenantA, `Yuri Wa ${letters()}`);
    const sub = await subCustomerWith(tenantA, x.customerId, [
      "customer.roles.view",
      "customer.sub_customers.view",
      "customer.sub_customers.create",
      "customer.sub_customers.edit",
      "customer.sub_customers.suspend",
    ]);
    const ySub = await subCustomerWith(tenantA, y.customerId, ["customer.sub_customers.view"]);
    await signIn(tenantA, sub.userId, "customer");

    // Created under X (its main customer), never under the acting sub-customer.
    const { data, username } = subUserForm([sub.roleId], { accountType: "label" });
    await redirected(() => createSubCustomerAction({ status: "idle" }, data));
    const parent = await tenantA.rt.query<{ parent_id: string }>(
      "SELECT c.parent_id::text AS parent_id FROM users u JOIN customers c ON c.id = u.customer_id WHERE u.username = $1",
      [username],
    );
    expect(parent.rows[0]?.parent_id).toBe(x.customerId);
    expect(parent.rows[0]?.parent_id).not.toBe(sub.customerId);

    // Y's role and sub-customer are "not found" from X's tree.
    expect(await loadCustomerRolePrivilegesAction(ySub.roleId)).toMatchObject({ ok: false });
    expect(await loadCustomerRoleUsersAction(ySub.roleId, 1)).toMatchObject({ ok: false });
    expect(await updateSubCustomerAction(ySub.userId, { status: "idle" }, form({ fullName: "Hijack Name", roleId: [sub.roleId] }))).toMatchObject({
      status: "error",
    });
    expect(await setSubCustomerStatusAction(ySub.userId, "suspend")).toMatchObject({ ok: false });
    const yStatus = await tenantA.rt.query<{ status: string }>("SELECT status::text AS status FROM customers WHERE id = $1", [ySub.customerId]);
    expect(yStatus.rows[0]?.status).toBe("active");

    // A Y role id in X's role pages is a 404, and X's lists never contain Y's accounts.
    const page = await CustomerRoleDetailsPage({ params: Promise.resolve({ id: ySub.roleId }), searchParams: Promise.resolve({}) });
    const screen = page as { type: (props: unknown) => Promise<unknown>; props: unknown };
    await expect(screen.type(screen.props)).rejects.toThrow("NEXT_NOT_FOUND");
    const records = await loadSubCustomerRecordsAction("all", 1);
    expect(records.ok && records.page.rows.some((row) => row.id === ySub.userId)).toBe(false);
  });
});

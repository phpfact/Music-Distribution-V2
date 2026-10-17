/**
 * RBAC security test matrix — the owner's required security scenarios that
 * were not yet covered directly by another suite
 * (.vibe/memory/role-privilege-management.md, "Technical Notes" →
 * "Security test matrix" maps EVERY scenario to its test).
 *
 * What this file adds:
 * - single role for all three sub-user kinds through the real Server Actions
 *   (none, several, other domain, foreign scope, tampered ids), customer
 *   reassignment and concurrent customer assignments;
 * - delegation: copying a master role's name/description grants nothing,
 *   disabled-module privileges cannot be re-enabled through tenant role
 *   editing, nobody edits their own role or account (tenant + customer);
 * - immediate revocation: stale fingerprints and old form posts after a
 *   revocation, suspended accounts (platform, tenant, customer), two
 *   independent tenant database clients, a failed role update that grants
 *   nothing (validation and a database failure);
 * - hidden navigation never opens the backend (direct calls refused);
 * - a static scan of every Server Action under src/app: each calls an
 *   authorize* guard or is on the explicit session-only allow-list.
 *
 * Real scratch control plane and two REAL provisioned tenants; only the
 * request plumbing of Next.js (cookies, headers, redirect, cache, after) and
 * the Host-header tenant lookup are replaced.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Client } from "pg";
import ts from "typescript";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient as TenantPrismaClient } from "@/generated/prisma/tenant/client";
import { tenantActor, type TenantAuthzActor } from "@/lib/authz/actor";
import { getPermission } from "@/lib/authz/catalog";
import { loadPlatformAccess } from "@/lib/authz/platform-access";
import { FORBIDDEN_MESSAGE, NO_ACTIVE_ROLE_MESSAGE } from "@/lib/authz/resolver";
import { createRole, setRoleStatus, updateRole } from "@/lib/authz/role-service";
import { setSubUserStatus, updateSubUser } from "@/lib/authz/sub-user-service";
import { loadDisabledTenantModules, resolveWorkspaceAccess } from "@/lib/authz/workspace-access";
import { getControlDb } from "@/lib/db/control";
import type { TenantDb } from "@/lib/db/tenant";
import { loadTenantDatabase } from "@/lib/tenants/database-target";
import { createUserSession, validateUserSession } from "@/lib/workspace/sessions";
import { closeAppDatabase } from "./support/app-connections";
import {
  clearPlatformTables,
  clearTenantTables,
  connectToTestDatabase,
  insertOwner,
  insertPlatformRole,
  insertSession,
  masterPlatformRoleId,
  sha256Hex,
} from "./support/postgres";
import {
  approvedCustomer,
  assignRole,
  closeRbacTenant,
  customerActorOf,
  insertCustomer,
  insertRole,
  insertUser,
  letters,
  one,
  openRbacTenant,
  platformActorOf,
  STRONG_PASSWORD,
  suffix,
  tenantActorOf,
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
  /** The redirect of Next.js: thrown like the real one, recorded for assertions. */
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT ${target}`);
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.cookies.has(name) ? { name, value: mocks.cookies.get(name) } : undefined),
  }),
  headers: async () =>
    new Headers({ host: "matrix.test", origin: "http://matrix.test", "sec-fetch-site": "same-origin", "x-forwarded-for": "203.0.113.99" }),
}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
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
import { platformFingerprintAction } from "@/app/platform/actions";
import { createRoleAction } from "@/app/platform/(console)/roles/actions";
import { createSubPlatformOwnerAction } from "@/app/platform/(console)/users/actions";
import { filterNavSections } from "@/app/platform/(console)/navigation";
import { tenantFingerprintAction } from "@/app/(workspace)/tenant/actions";
import { tenantDashboardConfig } from "@/app/(workspace)/tenant/navigation";
import { createTenantRoleAction } from "@/app/(workspace)/tenant/roles/actions";
import { createSubTenantAction, loadSubTenantRecordsAction } from "@/app/(workspace)/tenant/users/actions";
import { customerDashboardConfig } from "@/app/(workspace)/customer/(portal)/navigation";
import { createCustomerRoleAction } from "@/app/(workspace)/customer/(portal)/roles/actions";
import {
  createSubCustomerAction,
  loadSubCustomerRecordsAction,
  updateSubCustomerAction,
} from "@/app/(workspace)/customer/(portal)/sub-customers/actions";

const PLATFORM_COOKIE = "md_platform_session";
const TENANT_COOKIE   = "md_tenant_session";
const CUSTOMER_COOKIE = "md_customer_session";
const HASH            = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo";

let control: Client;
let resources: TenantResources;
let tenantA: RbacTenant;
let tenantB: RbacTenant;
let masterRoleId: string;
let primaryOwnerId: string;

beforeAll(async () => {
  control = await connectToTestDatabase();
  await clearPlatformTables(control);
  await clearTenantTables(control);
  resources = await TenantResources.open(control);

  // One primary Master Platform holder (lockout protection needs exactly one primary).
  masterRoleId   = await masterPlatformRoleId(control);
  primaryOwnerId = await insertOwner(control, { username: `vt-mx-m-${suffix()}`, passwordHash: HASH });
  await control.query("UPDATE platform_owners SET is_primary = true WHERE id = $1", [primaryOwnerId]);

  // Two real tenants: their databases are separate.
  tenantA = await openRbacTenant("rbacmxa", randomUUID());
  tenantB = await openRbacTenant("rbacmxb", randomUUID());
});

beforeEach(() => {
  mocks.cookies.clear();
  mocks.redirect.mockClear();
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

/**
 * Description: Build a FormData from plain values (arrays become repeated entries).
 * Input: Field name → value or list of values.
 * Output: The FormData a browser would post.
 * Use case: Every form Server Action call of this file.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function form(values: Record<string, string | readonly string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const entry of typeof value === "string" ? [value] : value) data.append(key, entry);
  }
  return data;
}

/**
 * Description: Run an action and report whether it redirected or returned.
 * Input: The action call.
 * Output: `{ redirectedTo }` when it threw the (mocked) Next.js redirect, else `{ value }`.
 * Use case: Actions that redirect on success or when the session is gone.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
async function outcome<T>(run: () => Promise<T>): Promise<{ redirectedTo: string } | { value: T }> {
  try {
    return { value: await run() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("NEXT_REDIRECT ")) return { redirectedTo: message.slice("NEXT_REDIRECT ".length) };
    throw error;
  }
}

/**
 * Description: The message a refusal carries, whatever the action's result shape is.
 * Input: An action result.
 * Output: Its `error`, `formMessage` or `message` text, or undefined.
 * Use case: Asserting the friendly forbidden / no-role messages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function refusalMessage(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const record = result as Record<string, unknown>;
  for (const key of ["error", "formMessage", "message"]) if (typeof record[key] === "string") return record[key] as string;
  return undefined;
}

/**
 * Description: Sign a platform owner in for this "request" (real session row, cookie set).
 * Input: The owner id.
 * Output: The raw session token.
 * Use case: Platform Server Action calls.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
async function signInOwner(ownerId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await insertSession(control, { ownerId, tokenHash: sha256Hex(token), lastUsedMinutesAgo: 5 });
  mocks.cookies.set(PLATFORM_COOKIE, token);
  return token;
}

/**
 * Description: Sign a workspace user of tenant `t` in for this "request".
 * Input: The tenant, the user id and the area.
 * Output: The raw session token (also set as the area cookie).
 * Use case: Tenant / customer Server Action calls.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
async function signInWorkspace(t: RbacTenant, userId: string, area: "tenant" | "customer"): Promise<string> {
  mocks.workspace = t.ws;
  const token = await createUserSession(t.ws.db, t.tenant.id, userId, area);
  mocks.cookies.set(area === "tenant" ? TENANT_COOKIE : CUSTOMER_COOKIE, token);
  return token;
}

/**
 * Description: A tenant staff user holding a new custom tenant role with exactly these keys.
 * Input: The tenant and the privilege keys.
 * Output: The user id and the role id.
 * Use case: Actors with a precise tenant ceiling.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
async function staffWith(t: RbacTenant, keys: string[]): Promise<{ userId: string; roleId: string }> {
  const roleId = await insertRole(t.rt, { name: `VT Mx ${suffix()}`, domain: "tenant", keys });
  const userId = await insertUser(t.rt, { handle: "mx" });
  await assignRole(t.rt, userId, roleId);
  return { userId, roleId };
}

/**
 * Description: A sub-customer user under a main customer holding a new role of that main customer.
 * Input: The tenant, the main customer id and the privilege keys.
 * Output: The user, sub-customer and role ids.
 * Use case: Sub-Customer actors with a precise customer ceiling.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
async function subCustomerWith(t: RbacTenant, mainCustomerId: string, keys: string[]): Promise<{ userId: string; customerId: string; roleId: string }> {
  const roleId     = await insertRole(t.rt, { name: `VT Mxc ${suffix()}`, domain: "customer", owner: mainCustomerId, keys });
  const customerId = await insertCustomer(t.rt, `Mx Sub ${letters()}`, mainCustomerId);
  const userId     = await insertUser(t.rt, { handle: "mxc", customerId });
  await assignRole(t.rt, userId, roleId);
  return { userId, customerId, roleId };
}

/**
 * Description: The privileges a workspace session token resolves to right now (fresh read).
 * Input: The database client to read through, the tenant, the area and the token.
 * Output: The effective privilege keys, or null when the session is refused.
 * Use case: Proving "the next request" sees a change, through any client.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
async function sessionPermissions(db: TenantDb, t: RbacTenant, area: "tenant" | "customer", token: string): Promise<readonly string[] | null> {
  const user = await validateUserSession(db, t.tenant.id, area, token, { touch: false });
  if (!user) return null;
  const disabledModules = await loadDisabledTenantModules(getControlDb(), t.tenant.id);
  return resolveWorkspaceAccess(user, area, disabledModules).permissions;
}

/**
 * Description: Build a tenant actor exactly like the guards do, but on a GIVEN database client.
 * Input: The tenant database client (a second "app instance"), the tenant and the user id.
 * Output: The tenant authz actor.
 * Use case: Proving two independent app instances agree without any shared cache.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
async function tenantActorOn(db: TenantDb, t: RbacTenant, userId: string): Promise<TenantAuthzActor> {
  const token = await createUserSession(db, t.tenant.id, userId, "tenant");
  const user  = await validateUserSession(db, t.tenant.id, "tenant", token);
  if (!user) throw new Error("tenant session refused");
  const disabledModules = await loadDisabledTenantModules(getControlDb(), t.tenant.id);
  const authz           = resolveWorkspaceAccess(user, "tenant", disabledModules);
  return tenantActor({ tenant: t.ws.tenant, db, user, authz }, { disabledModules });
}

/**
 * Description: The sorted privilege keys stored on a platform role.
 * Input: The role id.
 * Output: Sorted keys.
 * Use case: Proving a refused / failed update changed nothing.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
async function platformRoleKeys(roleId: string): Promise<string[]> {
  const result = await control.query<{ key: string }>(
    "SELECT permission_key AS key FROM platform_role_permissions WHERE role_id = $1 ORDER BY permission_key",
    [roleId],
  );
  return result.rows.map((row) => row.key);
}

/**
 * Description: The role input of a role-service create/update call.
 * Input: Name, privilege keys, optional description.
 * Output: A RoleInput-shaped object (active status).
 * Use case: Service-level role calls.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function roleInput(name: string, permissions: unknown, description = "") {
  return { name, description, status: "active", permissions };
}

// ---------------------------------------------------------------------------
// Single role (i, j, k, l): every sub-user kind, through its real Server Action.

/** Tampered role ids a crafted request might send (never valid UUIDs of the scope). */
const TAMPERED_IDS = ["not-a-uuid", "' OR '1'='1", `${randomUUID()},${randomUUID()}`, randomUUID(), "", "00000000-0000-0000-0000-000000000000"];

describe("single role: every sub-user kind needs exactly one valid role of its own domain and scope", () => {
  it("Sub-Platform Owner: none, several, a tenant/customer role or a tampered id is refused; nothing is created", async () => {
    const a = await insertPlatformRole(control, { name: `VT Mx A ${suffix()}`, permissionKeys: ["platform.tenants.view"] });
    const b = await insertPlatformRole(control, { name: `VT Mx B ${suffix()}`, permissionKeys: ["platform.users.view"] });
    await signInOwner(primaryOwnerId);

    const cases: string[][] = [[], [a, b], [a, a], [tenantA.masterTenantId], [tenantA.masterCustomerId], ...TAMPERED_IDS.map((id) => [id])];
    for (const roleIds of cases) {
      const username = `vtmxp${suffix()}`;
      const data     = form({ fullName: `Mx Owner ${letters()}`, username, password: STRONG_PASSWORD, confirmPassword: STRONG_PASSWORD, roleId: roleIds });
      const result   = await outcome(() => createSubPlatformOwnerAction({ status: "idle" }, data));
      expect(result, JSON.stringify(roleIds)).toMatchObject({ value: { status: "error", fieldErrors: { roleId: expect.any(String) } } });
      expect((await control.query("SELECT 1 FROM platform_owners WHERE username = $1", [username])).rowCount).toBe(0);
    }
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("Sub-Tenant: none, several, a customer/platform role, another tenant's role or a tampered id is refused", async () => {
    const own     = await insertRole(tenantA.rt, { name: `VT Mx Own ${suffix()}`, domain: "tenant", keys: ["tenant.users.view"] });
    const foreign = await insertRole(tenantB.rt, { name: `VT Mx Far ${suffix()}`, domain: "tenant", keys: ["tenant.users.view"] });
    await signInWorkspace(tenantA, tenantA.adminId, "tenant");

    const cases: string[][] = [[], [own, tenantA.masterTenantId], [tenantA.masterCustomerId], [masterRoleId], [foreign], [tenantB.masterTenantId], ...TAMPERED_IDS.map((id) => [id])];
    for (const roleIds of cases) {
      const username = `vt-mxt-${suffix()}`;
      const data = form({
        fullName: `Mx Staff ${letters()}`,
        username,
        email: `${username}@example.com`,
        password: STRONG_PASSWORD,
        confirmPassword: STRONG_PASSWORD,
        roleId: roleIds,
      });
      const result = await outcome(() => createSubTenantAction({ status: "idle" }, data));
      expect(result, JSON.stringify(roleIds)).toMatchObject({ value: { status: "error", fieldErrors: { roleId: expect.any(String) } } });
      expect(await one(tenantA.rt, "SELECT count(*)::text AS id FROM users WHERE username = $1", [username])).toBe("0");
    }
  });

  it("Sub-Customer: none, several, a tenant role, another main customer's role or a tampered id is refused; no customer row is left", async () => {
    const x     = await approvedCustomer(tenantA, `Mx Xavier ${letters()}`);
    const y     = await approvedCustomer(tenantA, `Mx Yvonne ${letters()}`);
    const roleX = await insertRole(tenantA.rt, { name: `VT Mx X ${suffix()}`, domain: "customer", owner: x.customerId, keys: ["customer.sub_customers.view"] });
    const roleY = await insertRole(tenantA.rt, { name: `VT Mx Y ${suffix()}`, domain: "customer", owner: y.customerId, keys: ["customer.sub_customers.view"] });
    await signInWorkspace(tenantA, x.userId, "customer");
    const customersBefore = await one(tenantA.rt, "SELECT count(*)::text AS id FROM customers");

    const cases: string[][] = [[], [roleX, tenantA.masterCustomerId], [tenantA.masterTenantId], [masterRoleId], [roleY], [tenantB.masterCustomerId], ...TAMPERED_IDS.map((id) => [id])];
    for (const roleIds of cases) {
      const username = `vt-mxc-${suffix()}`;
      const data = form({
        fullName: `Mx Sub ${letters()}`,
        accountType: "artist",
        username,
        email: `${username}@example.com`,
        password: STRONG_PASSWORD,
        confirmPassword: STRONG_PASSWORD,
        roleId: roleIds,
      });
      const result = await outcome(() => createSubCustomerAction({ status: "idle" }, data));
      expect(result, JSON.stringify(roleIds)).toMatchObject({ value: { status: "error", fieldErrors: { roleId: expect.any(String) } } });
      expect(await one(tenantA.rt, "SELECT count(*)::text AS id FROM users WHERE username = $1", [username])).toBe("0");
    }
    // The customer row and its user are written in one transaction: nothing half-created.
    expect(await one(tenantA.rt, "SELECT count(*)::text AS id FROM customers")).toBe(customersBefore);
  });

  it("Sub-Customer reassignment replaces the role (never merges); several role ids on edit change nothing", async () => {
    const x     = await approvedCustomer(tenantA, `Mx Rhea ${letters()}`);
    const roleA = await insertRole(tenantA.rt, { name: `VT Mx Ra ${suffix()}`, domain: "customer", owner: x.customerId, keys: ["customer.sub_customers.view"] });
    const roleB = await insertRole(tenantA.rt, { name: `VT Mx Rb ${suffix()}`, domain: "customer", owner: x.customerId, keys: ["customer.roles.view"] });
    const sub   = await insertCustomer(tenantA.rt, `Mx Sub ${letters()}`, x.customerId);
    const user  = await insertUser(tenantA.rt, { handle: "mxr", customerId: sub });
    await assignRole(tenantA.rt, user, roleA);
    const subToken = await createUserSession(tenantA.ws.db, tenantA.tenant.id, user, "customer");
    expect(await sessionPermissions(tenantA.ws.db, tenantA, "customer", subToken)).toStrictEqual(["customer.sub_customers.view"]);

    await signInWorkspace(tenantA, x.userId, "customer");
    // Two role ids on edit: refused, the old role stays.
    const several = await outcome(() => updateSubCustomerAction(user, { status: "idle" }, form({ fullName: "Mx Renamed", roleId: [roleA, roleB] })));
    expect(several).toMatchObject({ value: { status: "error", fieldErrors: { roleId: expect.any(String) } } });
    expect(await one(tenantA.rt, "SELECT role_id::text AS id FROM user_roles WHERE user_id = $1", [user])).toBe(roleA);

    // One role id: replaced; the next request has ONLY the new role's privileges.
    const replaced = await outcome(() => updateSubCustomerAction(user, { status: "idle" }, form({ fullName: "Mx Renamed", roleId: [roleB] })));
    expect(replaced).toStrictEqual({ redirectedTo: "/customer/sub-customers?notice=user-saved" });
    const rows = await tenantA.rt.query<{ role_id: string }>("SELECT role_id::text AS role_id FROM user_roles WHERE user_id = $1", [user]);
    expect(rows.rows).toStrictEqual([{ role_id: roleB }]);
    expect(await sessionPermissions(tenantA.ws.db, tenantA, "customer", subToken)).toStrictEqual(["customer.roles.view"]);
  });

  it("concurrent Sub-Customer reassignments leave exactly one role", async () => {
    const x      = await approvedCustomer(tenantA, `Mx Cleo ${letters()}`);
    const roleA  = await insertRole(tenantA.rt, { name: `VT Mx Ca ${suffix()}`, domain: "customer", owner: x.customerId, keys: ["customer.sub_customers.view"] });
    const roleB  = await insertRole(tenantA.rt, { name: `VT Mx Cb ${suffix()}`, domain: "customer", owner: x.customerId, keys: ["customer.roles.view"] });
    const sub    = await insertCustomer(tenantA.rt, `Mx Sub ${letters()}`, x.customerId);
    const user   = await insertUser(tenantA.rt, { handle: "mxcc", customerId: sub });
    await assignRole(tenantA.rt, user, roleA);
    const actorX = await customerActorOf(tenantA, x.userId);

    const results = await Promise.all([
      updateSubUser(actorX, user, { fullName: "Mx Concurrent", roleId: [roleB] }),
      updateSubUser(actorX, user, { fullName: "Mx Concurrent", roleId: [roleA] }),
      updateSubUser(actorX, user, { fullName: "Mx Concurrent", roleId: [roleB] }),
    ]);
    // Every call either succeeded or was refused cleanly (never a half write).
    for (const result of results) expect(typeof result.ok).toBe("boolean");
    const held = await tenantA.rt.query<{ role_id: string }>("SELECT role_id::text AS role_id FROM user_roles WHERE user_id = $1", [user]);
    expect(held.rows).toHaveLength(1);
    expect([roleA, roleB]).toContain(held.rows[0]?.role_id);
  });
});

// ---------------------------------------------------------------------------
// Delegation (q, r, s).

describe("delegation", () => {
  it("copying a master role's name or description grants nothing (platform, tenant, customer)", async () => {
    // Platform: the exact master name is reserved; a look-alike name + the master's description is just a custom role.
    const master      = await platformActorOf(primaryOwnerId);
    const description = (await control.query<{ description: string | null }>("SELECT description FROM platform_roles WHERE id = $1", [masterRoleId])).rows[0]?.description ?? "";
    expect(await createRole(master, roleInput(" master platform ", ["platform.tenants.view"], description))).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String) } });
    const copy = await createRole(master, roleInput(`Master Platform Copy ${letters(4)}`, ["platform.tenants.view"], description));
    expect(copy).toMatchObject({ ok: true });
    if (!copy.ok) return;
    expect(await one(control, "SELECT COALESCE(system_key, 'none') AS id FROM platform_roles WHERE id = $1", [copy.roleId])).toBe("none");
    const holder = await insertOwner(control, { username: `vt-mx-cp-${suffix()}`, passwordHash: HASH, roleId: copy.roleId });
    expect(await loadPlatformAccess(getControlDb(), holder)).toMatchObject({ isMaster: false, permissions: ["platform.tenants.view"] });

    // Tenant: same rule.
    const tenantMaster = await tenantActorOf(tenantA, tenantA.adminId);
    const tenantDesc   = (await tenantA.rt.query<{ description: string | null }>("SELECT description FROM roles WHERE id = $1", [tenantA.masterTenantId])).rows[0]?.description ?? "";
    expect(await createRole(tenantMaster, roleInput("MASTER TENANT", ["tenant.users.view"], tenantDesc))).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String) } });
    const tenantCopy = await createRole(tenantMaster, roleInput(`Master Tenant (copy) ${letters(4)}`, ["tenant.users.view"], tenantDesc));
    expect(tenantCopy).toMatchObject({ ok: true });
    if (!tenantCopy.ok) return;
    const staff = await insertUser(tenantA.rt, { handle: "mxcopy" });
    await assignRole(tenantA.rt, staff, tenantCopy.roleId);
    const staffToken = await createUserSession(tenantA.ws.db, tenantA.tenant.id, staff, "tenant");
    expect(await sessionPermissions(tenantA.ws.db, tenantA, "tenant", staffToken)).toStrictEqual(["tenant.users.view"]);

    // Customer: same rule.
    const x      = await approvedCustomer(tenantA, `Mx Copycat ${letters()}`);
    const actorX = await customerActorOf(tenantA, x.userId);
    expect(await createRole(actorX, roleInput("Master Customer", ["customer.roles.view"]))).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String) } });
    const custCopy = await createRole(actorX, roleInput(`Master Customer Copy ${letters(4)}`, ["customer.roles.view"]));
    expect(custCopy).toMatchObject({ ok: true });
    if (!custCopy.ok) return;
    const sub     = await insertCustomer(tenantA.rt, `Mx Sub ${letters()}`, x.customerId);
    const subUser = await insertUser(tenantA.rt, { handle: "mxcc", customerId: sub });
    await assignRole(tenantA.rt, subUser, custCopy.roleId);
    const subToken = await createUserSession(tenantA.ws.db, tenantA.tenant.id, subUser, "customer");
    expect(await sessionPermissions(tenantA.ws.db, tenantA, "customer", subToken)).toStrictEqual(["customer.roles.view"]);
  });

  it("disabled-module privileges cannot be (re-)enabled through tenant role editing; they stay inert until the Platform Owner re-enables the module", async () => {
    const keeps  = await insertRole(tenantA.rt, { name: `VT Mx Keeps ${suffix()}`, domain: "tenant", keys: ["tenant.registrations.view", "tenant.users.view"] });
    const lacks  = await insertRole(tenantA.rt, { name: `VT Mx Lacks ${suffix()}`, domain: "tenant", keys: ["tenant.users.view"] });
    const holder = await insertUser(tenantA.rt, { handle: "mxmod" });
    await assignRole(tenantA.rt, holder, keeps);
    const token  = await createUserSession(tenantA.ws.db, tenantA.tenant.id, holder, "tenant");

    await control.query("INSERT INTO tenant_module_settings (tenant_id, module_key, enabled) VALUES ($1, 'tenant.registrations', false)", [tenantA.tenant.id]);
    try {
      const master = await tenantActorOf(tenantA, tenantA.adminId);
      // Neither a new role nor an edit may add the disabled module's privilege — not even for Master Tenant.
      expect(await createRole(master, roleInput(`Mx New ${letters()}`, ["tenant.registrations.view"]))).toMatchObject({
        ok: false,
        fieldErrors: { permissions: expect.stringContaining("disabled") },
      });
      expect(await updateRole(master, lacks, roleInput(`Mx Lacks ${letters()}`, ["tenant.users.view", "tenant.registrations.view"]))).toMatchObject({
        ok: false,
        fieldErrors: { permissions: expect.stringContaining("disabled") },
      });
      expect(await workspaceRoleKeys(tenantA.rt, lacks)).toStrictEqual(["tenant.users.view"]);

      // Editing a role that already stores it keeps it stored but inert.
      expect(await updateRole(master, keeps, roleInput(`Mx Keeps ${letters()}`, ["tenant.users.view", "tenant.users.create"]))).toMatchObject({ ok: true });
      expect(await workspaceRoleKeys(tenantA.rt, keeps)).toStrictEqual(["tenant.registrations.view", "tenant.users.create", "tenant.users.view"]);
      expect(await sessionPermissions(tenantA.ws.db, tenantA, "tenant", token)).toStrictEqual(["tenant.users.view", "tenant.users.create"]);
    } finally {
      await control.query("DELETE FROM tenant_module_settings WHERE tenant_id = $1", [tenantA.tenant.id]);
    }
    // Re-enabled centrally: the preserved privilege works again on the next request.
    expect(await sessionPermissions(tenantA.ws.db, tenantA, "tenant", token)).toContain("tenant.registrations.view");
  });

  it("nobody modifies their own role or account (tenant and customer)", async () => {
    // Tenant: a manager with every role/user privilege.
    const tenantKeys = ["tenant.roles.view", "tenant.roles.create", "tenant.roles.edit", "tenant.roles.delete", "tenant.users.view", "tenant.users.edit", "tenant.users.suspend"];
    const manager    = await staffWith(tenantA, tenantKeys);
    const actor      = await tenantActorOf(tenantA, manager.userId);
    // Even a change inside the actor's own ceiling (dropping one privilege) is refused for the own role.
    expect(await updateRole(actor, manager.roleId, roleInput(`Mx Self ${letters()}`, tenantKeys.filter((key) => key !== "tenant.roles.delete")))).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await setRoleStatus(actor, manager.roleId, "disabled")).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await updateSubUser(actor, manager.userId, { fullName: "Mx Self", roleId: [tenantA.masterTenantId] })).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await setSubUserStatus(actor, manager.userId, "suspend")).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await workspaceRoleKeys(tenantA.rt, manager.roleId)).toStrictEqual([...tenantKeys].sort());
    expect(await one(tenantA.rt, "SELECT role_id::text AS id FROM user_roles WHERE user_id = $1", [manager.userId])).toBe(manager.roleId);

    // Customer: a sub-customer manager under X.
    const x            = await approvedCustomer(tenantA, `Mx Selma ${letters()}`);
    const customerKeys = ["customer.roles.view", "customer.roles.edit", "customer.sub_customers.view", "customer.sub_customers.edit", "customer.sub_customers.suspend"];
    const sub          = await subCustomerWith(tenantA, x.customerId, customerKeys);
    const subActor     = await customerActorOf(tenantA, sub.userId);
    expect(await updateRole(subActor, sub.roleId, roleInput(`Mx Self ${letters()}`, customerKeys.filter((key) => key !== "customer.roles.edit")))).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await setRoleStatus(subActor, sub.roleId, "disabled")).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await updateSubUser(subActor, sub.userId, { fullName: "Mx Self", roleId: [tenantA.masterCustomerId] })).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await one(tenantA.rt, "SELECT role_id::text AS id FROM user_roles WHERE user_id = $1", [sub.userId])).toBe(sub.roleId);
  });
});

// ---------------------------------------------------------------------------
// Immediate revocation (w, x, y, z).

describe("immediate revocation", () => {
  it("platform: a stale fingerprint changes and an old form posted after the revocation is refused; a suspended account is signed out", async () => {
    const roleId  = await insertPlatformRole(control, { name: `VT Mx Stale ${suffix()}`, permissionKeys: ["platform.roles.view", "platform.roles.create", "platform.tenants.view"] });
    const ownerId = await insertOwner(control, { username: `vt-mx-st-${suffix()}`, passwordHash: HASH, roleId });
    await signInOwner(ownerId);

    // The editor page was opened while the privilege existed.
    const opened  = await platformFingerprintAction();
    const oldForm = form({ name: `Mx Stale ${letters()}`, description: "", status: "active", privileges: ["platform.tenants.view"] });

    // Revoked in another request.
    await control.query("DELETE FROM platform_role_permissions WHERE role_id = $1 AND permission_key = 'platform.roles.create'", [roleId]);
    const now = await platformFingerprintAction();
    expect(now.signedIn).toBe(true);
    expect(now.fingerprint).not.toBe(opened.fingerprint);

    // The old form posted now: refused, nothing written.
    const posted = await outcome(() => createRoleAction({ status: "idle" }, oldForm));
    expect(posted).toMatchObject({ value: { status: "error" } });
    expect(refusalMessage((posted as { value: unknown }).value)).toBe(FORBIDDEN_MESSAGE);
    expect((await control.query("SELECT 1 FROM platform_roles WHERE name = $1", [oldForm.get("name")])).rowCount).toBe(0);

    // The account is suspended: the old cookie is useless, every action goes to the login page.
    await control.query("UPDATE platform_owners SET status = 'disabled' WHERE id = $1", [ownerId]);
    expect(await platformFingerprintAction()).toStrictEqual({ signedIn: false, fingerprint: null });
    expect(await outcome(() => createRoleAction({ status: "idle" }, oldForm))).toStrictEqual({ redirectedTo: "/platform/login" });
  });

  it("tenant: a disabled role changes the fingerprint and refuses the old form; a suspended staff account is signed out", async () => {
    const staff = await staffWith(tenantA, ["tenant.users.view", "tenant.users.create"]);
    const role  = await insertRole(tenantA.rt, { name: `VT Mx Target ${suffix()}`, domain: "tenant", keys: ["tenant.users.view"] });
    await signInWorkspace(tenantA, staff.userId, "tenant");

    const opened   = await tenantFingerprintAction();
    const username = `vt-mx-old-${suffix()}`;
    const oldForm  = form({ fullName: `Mx Old ${letters()}`, username, email: `${username}@example.com`, password: STRONG_PASSWORD, confirmPassword: STRONG_PASSWORD, roleId: [role] });

    // The actor's role is disabled by another request.
    await tenantA.rt.query("UPDATE roles SET status = 'disabled' WHERE id = $1", [staff.roleId]);
    const now = await tenantFingerprintAction();
    expect(now.signedIn).toBe(true);
    expect(now.fingerprint).not.toBe(opened.fingerprint);
    const posted = await outcome(() => createSubTenantAction({ status: "idle" }, oldForm));
    expect(refusalMessage((posted as { value: unknown }).value)).toBe(NO_ACTIVE_ROLE_MESSAGE);
    expect(await one(tenantA.rt, "SELECT count(*)::text AS id FROM users WHERE username = $1", [username])).toBe("0");

    // The staff account is suspended: signed out on the next request.
    await tenantA.rt.query("UPDATE roles SET status = 'active' WHERE id = $1", [staff.roleId]);
    await tenantA.rt.query("UPDATE users SET status = 'disabled' WHERE id = $1", [staff.userId]);
    expect(await tenantFingerprintAction()).toStrictEqual({ signedIn: false, fingerprint: null });
    expect(await outcome(() => createSubTenantAction({ status: "idle" }, oldForm))).toStrictEqual({ redirectedTo: "/login" });
    expect(await one(tenantA.rt, "SELECT count(*)::text AS id FROM users WHERE username = $1", [username])).toBe("0");
  });

  it("customer: a sub-customer suspended by its main customer is refused on its next request", async () => {
    const x   = await approvedCustomer(tenantA, `Mx Susan ${letters()}`);
    const sub = await subCustomerWith(tenantA, x.customerId, ["customer.sub_customers.view"]);
    await signInWorkspace(tenantA, sub.userId, "customer");
    expect(await loadSubCustomerRecordsAction("all", 1)).toMatchObject({ ok: true });

    const actorX = await customerActorOf(tenantA, x.userId);
    expect(await setSubUserStatus(actorX, sub.userId, "suspend")).toMatchObject({ ok: true });
    expect(await outcome(() => loadSubCustomerRecordsAction("all", 1))).toStrictEqual({ redirectedTo: "/login" });
  });

  it("two independent app instances (separate tenant database clients) agree on the next request — no cross-request cache", async () => {
    const target = await loadTenantDatabase(tenantA.tenant.id);
    const second = new TenantPrismaClient({
      adapter: new PrismaPg({ host: process.env.POSTGRES_HOST?.trim(), port: target.port, database: target.database, user: target.user, password: target.password, max: 2 }),
    });
    try {
      const first = tenantA.ws.db;
      const role  = await insertRole(tenantA.rt, { name: `VT Mx Inst ${suffix()}`, domain: "tenant", keys: ["tenant.registrations.view", "tenant.users.view"] });
      const other = await insertRole(tenantA.rt, { name: `VT Mx Inst2 ${suffix()}`, domain: "tenant", keys: ["tenant.roles.view"] });
      const user  = await insertUser(tenantA.rt, { handle: "mxinst" });
      await assignRole(tenantA.rt, user, role);
      const token = await createUserSession(first, tenantA.tenant.id, user, "tenant");
      expect(await sessionPermissions(first, tenantA, "tenant", token)).toStrictEqual(["tenant.registrations.view", "tenant.users.view"]);
      expect(await sessionPermissions(second, tenantA, "tenant", token)).toStrictEqual(["tenant.registrations.view", "tenant.users.view"]);

      // Instance 2 revokes a privilege: instance 1's very next read no longer has it.
      const onSecond = await tenantActorOn(second, tenantA, tenantA.adminId);
      expect(await updateRole(onSecond, role, roleInput(`Mx Inst ${letters()}`, ["tenant.users.view"]))).toMatchObject({ ok: true });
      expect(await sessionPermissions(first, tenantA, "tenant", token)).toStrictEqual(["tenant.users.view"]);

      // Instance 1 reassigns the user: instance 2's very next read has only the new role.
      const onFirst = await tenantActorOf(tenantA, tenantA.adminId);
      expect(await updateSubUser(onFirst, user, { fullName: "Mx Instance", roleId: [other] })).toMatchObject({ ok: true });
      expect(await sessionPermissions(second, tenantA, "tenant", token)).toStrictEqual(["tenant.roles.view"]);

      // Instance 2 suspends the user: instance 1 refuses the session.
      expect(await setSubUserStatus(onSecond, user, "suspend")).toMatchObject({ ok: true });
      expect(await sessionPermissions(first, tenantA, "tenant", token)).toBeNull();
    } finally {
      await second.$disconnect();
    }
  });

  it("a failed permission update never grants partially: an invalid mix is refused whole, a database failure rolls everything back", async () => {
    const limitedRole = await insertPlatformRole(control, {
      name: `VT Mx Lim ${suffix()}`,
      permissionKeys: ["platform.roles.view", "platform.roles.edit", "platform.users.view", "platform.users.create"],
    });
    const limitedOwner = await insertOwner(control, { username: `vt-mx-lim-${suffix()}`, passwordHash: HASH, roleId: limitedRole });
    const roleName     = `VT Mx Partial ${suffix()}`;
    const roleId       = await insertPlatformRole(control, { name: roleName, permissionKeys: ["platform.roles.view", "platform.users.view"] });
    const holder       = await insertOwner(control, { username: `vt-mx-ph-${suffix()}`, passwordHash: HASH, roleId });

    // 1. A valid key next to one above the actor's ceiling: the whole request is refused.
    const limited = await platformActorOf(limitedOwner);
    expect(await updateRole(limited, roleId, roleInput(`${roleName} X`, ["platform.roles.view", "platform.users.view", "platform.users.create", "platform.tenants.create"]))).toMatchObject({
      ok: false,
      fieldErrors: { permissions: expect.any(String) },
    });
    expect(await platformRoleKeys(roleId)).toStrictEqual(["platform.roles.view", "platform.users.view"]);
    expect(await one(control, "SELECT name AS id FROM platform_roles WHERE id = $1", [roleId])).toBe(roleName);

    // 2. A database failure in the middle of a valid update (after the rename and the removals).
    await control.query(`
      CREATE OR REPLACE FUNCTION vt_mx_fail_grant() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.role_id = '${roleId}'::uuid AND NEW.permission_key = 'platform.users.create' THEN RAISE EXCEPTION 'simulated failure'; END IF;
        RETURN NEW;
      END $$`);
    await control.query("CREATE TRIGGER vt_mx_fail_grant BEFORE INSERT ON platform_role_permissions FOR EACH ROW EXECUTE FUNCTION vt_mx_fail_grant()");
    try {
      const master = await platformActorOf(primaryOwnerId);
      const result = await updateRole(master, roleId, roleInput(`${roleName} Renamed`, ["platform.users.view", "platform.users.create"]));
      expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    } finally {
      await control.query("DROP TRIGGER IF EXISTS vt_mx_fail_grant ON platform_role_permissions");
      await control.query("DROP FUNCTION IF EXISTS vt_mx_fail_grant()");
    }
    expect(await platformRoleKeys(roleId)).toStrictEqual(["platform.roles.view", "platform.users.view"]);
    expect(await one(control, "SELECT name AS id FROM platform_roles WHERE id = $1", [roleId])).toBe(roleName);
    expect((await loadPlatformAccess(getControlDb(), holder)).permissions).toStrictEqual(["platform.roles.view", "platform.users.view"]);
  });
});

// ---------------------------------------------------------------------------
// Existing functionality (ee): a hidden menu entry never opens the backend.

describe("hidden navigation never opens the backend", () => {
  it("platform: without the privilege the entry is hidden AND the direct action is refused", async () => {
    const roleId  = await insertPlatformRole(control, { name: `VT Mx Nav ${suffix()}`, permissionKeys: ["platform.tenants.view"] });
    const ownerId = await insertOwner(control, { username: `vt-mx-nav-${suffix()}`, passwordHash: HASH, roleId });
    const access  = await loadPlatformAccess(getControlDb(), ownerId);
    const hrefs   = filterNavSections(access.permissions).flatMap((section) => section.items.flatMap((item) => [item.href, ...(item.children ?? []).map((child) => child.href)]));
    expect(hrefs).toContain("/platform/tenants");
    expect(hrefs).not.toContain("/platform/roles");
    expect(hrefs).not.toContain("/platform/users");

    await signInOwner(ownerId);
    const role = await outcome(() => createRoleAction({ status: "idle" }, form({ name: `Mx Hidden ${letters()}`, description: "", status: "active", privileges: ["platform.tenants.view"] })));
    expect(refusalMessage((role as { value: unknown }).value)).toBe(FORBIDDEN_MESSAGE);
    const username = `vtmxhid${suffix()}`;
    const user = await outcome(() =>
      createSubPlatformOwnerAction({ status: "idle" }, form({ fullName: `Mx Hidden ${letters()}`, username, password: STRONG_PASSWORD, confirmPassword: STRONG_PASSWORD, roleId: [roleId] })),
    );
    expect(refusalMessage((user as { value: unknown }).value)).toBe(FORBIDDEN_MESSAGE);
    expect((await control.query("SELECT 1 FROM platform_owners WHERE username = $1", [username])).rowCount).toBe(0);
  });

  it("tenant and customer: hidden Access control / Account entries and refused direct actions", async () => {
    // Tenant staff with registrations only.
    const staff = await staffWith(tenantA, ["tenant.registrations.view"]);
    await signInWorkspace(tenantA, staff.userId, "tenant");
    const tenantUser = await validateUserSession(tenantA.ws.db, tenantA.tenant.id, "tenant", mocks.cookies.get(TENANT_COOKIE) ?? "", { touch: false });
    if (!tenantUser) throw new Error("tenant session refused");
    const tenantAuthz = resolveWorkspaceAccess(tenantUser, "tenant", []);
    const tenantNav   = tenantDashboardConfig("T", { name: "Mx", username: "mx", email: "mx@example.com", role: tenantUser.role }, tenantAuthz);
    const tenantHrefs = [...tenantNav.navMain, ...tenantNav.navGroups.flatMap((group) => group.items)].map((item) => item.href);
    expect(tenantHrefs).not.toContain("/tenant/users");
    expect(tenantHrefs).not.toContain("/tenant/roles");
    expect(await loadSubTenantRecordsAction("all", 1)).toStrictEqual({ ok: false, error: FORBIDDEN_MESSAGE });
    const tenantRole = await outcome(() => createTenantRoleAction({ status: "idle" }, form({ name: `Mx Hidden ${letters()}`, description: "", status: "active", privileges: ["tenant.registrations.view"] })));
    expect(refusalMessage((tenantRole as { value: unknown }).value)).toBe(FORBIDDEN_MESSAGE);

    // Sub-customer with no Account privileges at all (role holds nothing of the Account group).
    const x   = await approvedCustomer(tenantA, `Mx Hidden ${letters()}`);
    const sub = await subCustomerWith(tenantA, x.customerId, ["customer.roles.view"]);
    await signInWorkspace(tenantA, sub.userId, "customer");
    const customerUser = await validateUserSession(tenantA.ws.db, tenantA.tenant.id, "customer", mocks.cookies.get(CUSTOMER_COOKIE) ?? "", { touch: false });
    if (!customerUser?.customer) throw new Error("customer session refused");
    const customerAuthz = resolveWorkspaceAccess(customerUser, "customer", []);
    const customerNav   = customerDashboardConfig(
      "T",
      { name: "Mx", username: "mx", email: "mx@example.com", role: customerUser.role, customer: { type: customerUser.customer.type } },
      customerAuthz,
    );
    const customerHrefs = customerNav.navGroups.flatMap((group) => group.items).map((item) => item.href);
    expect(customerHrefs).not.toContain("/customer/sub-customers");
    expect(await loadSubCustomerRecordsAction("all", 1)).toStrictEqual({ ok: false, error: FORBIDDEN_MESSAGE });
    const customerRole = await outcome(() => createCustomerRoleAction({ status: "idle" }, form({ name: `Mx Hidden ${letters()}`, description: "", status: "active", privileges: ["customer.roles.view"] })));
    expect(refusalMessage((customerRole as { value: unknown }).value)).toBe(FORBIDDEN_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// Existing functionality (dd): every Server Action is guarded or explicitly session-only.

/**
 * Session-only Server Actions (by design, see "Enforcement map" → "Session
 * only"): sign-in/out, customer sign-up and review request, the privilege
 * fingerprint, personal appearance. File (relative to src/app) → action names.
 * Anything else must call an authorize* guard.
 */
const SESSION_ONLY_ACTIONS: Record<string, readonly string[]> = {
  "platform/actions.ts": ["logoutAction", "platformFingerprintAction"],
  "platform/login/actions.ts": ["loginAction"],
  "platform/(console)/settings/appearance/actions.ts": ["refreshAppearanceAction"],
  "(workspace)/login/actions.ts": ["workspaceLoginAction"],
  "(workspace)/tenant/actions.ts": ["tenantLogoutAction", "tenantFingerprintAction"],
  "(workspace)/customer/(portal)/actions.ts": ["customerLogoutAction", "customerFingerprintAction", "saveCustomerAppearanceAction"],
  "(workspace)/customer/(public)/registration/actions.ts": ["requestReviewAction", "applicantLogoutAction"],
  "(workspace)/customer/(public)/signup/actions.ts": ["signupAction"],
};

/** The privilege-checking entry points every guarded action must reach (src/lib/authz/{platform,workspace}.ts). */
const CORE_GUARDS = new Set(["authorizePlatformAction", "authorizeTenantAction", "authorizeCustomerAction"]);

/**
 * Description: List every file below a directory, recursively.
 * Input: An absolute directory path.
 * Output: Absolute file paths.
 * Use case: Finding every Server Action file under src/app.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function filesBelow(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    return statSync(full).isDirectory() ? filesBelow(full) : [full];
  });
}

/**
 * Description: Tell whether a source file starts with the "use server" directive.
 * Input: A parsed source file.
 * Output: True for a module-level Server Action file.
 * Use case: The static Server Action scan.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function isUseServerFile(source: ts.SourceFile): boolean {
  const first = source.statements[0];
  return !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server";
}

/**
 * Description: Collect the names of every function called anywhere inside a node.
 * Input: A node (a function body).
 * Output: Identifiers of the called functions (plain calls only).
 * Use case: Detecting guard calls, including inside `() => authorize…(…)` arguments.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function calledNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) names.add(child.expression.text);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return names;
}

/**
 * Description: Collect the first string-literal argument of every `authorize…("…")` call inside a node.
 * Input: A node (a function body).
 * Output: The privilege keys literally passed to authorize* functions.
 * Use case: Checking every guarded action names a real privilege of its own panel's domain.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function authorizeLiterals(node: ts.Node): string[] {
  const keys: string[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text.startsWith("authorize")) {
      // Unwrap `("key")`, `"key" as …` and `"key" satisfies …` so a cast cannot hide the key.
      let first: ts.Expression | undefined = child.arguments[0];
      while (first && (ts.isParenthesizedExpression(first) || ts.isAsExpression(first) || ts.isSatisfiesExpression(first))) first = first.expression;
      if (first && ts.isStringLiteralLike(first)) keys.push(first.text);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return keys;
}

/**
 * Description: Map each top-level function of a file (exported or not) to its body node.
 * Input: A parsed source file.
 * Output: Name → { node, exported }.
 * Use case: Following an action into its local authorize helper and listing exported actions.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function topLevelFunctions(source: ts.SourceFile): Map<string, { node: ts.Node; exported: boolean }> {
  const functions = new Map<string, { node: ts.Node; exported: boolean }>();
  for (const statement of source.statements) {
    const exported = ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      functions.set(statement.name.text, { node: statement.body, exported });
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) functions.set(declaration.name.text, { node: declaration.initializer, exported });
      }
    }
  }
  return functions;
}

/**
 * Description: The names in a file that reach a core guard: imported authorize* helpers that do (panel actors), plus local functions that call one.
 * Input: A parsed source file and the names of imported functions known to reach a core guard.
 * Output: The set of guard names usable by that file's actions.
 * Use case: An action passes when it calls any of these.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function guardNamesOf(source: ts.SourceFile, importedGuards: ReadonlySet<string>): Set<string> {
  const guards = new Set<string>([...CORE_GUARDS, ...importedGuards]);
  for (const [name, fn] of topLevelFunctions(source)) {
    if (fn.exported) continue;
    if ([...calledNames(fn.node)].some((called) => guards.has(called))) guards.add(name);
  }
  return guards;
}

describe("every Server Action is guarded or explicitly session-only", () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const parse   = (file: string) => ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);

  // Panel actors (rbac-actor.ts): their authorize*Actor functions count as guards only if they reach a core guard.
  const actorGuards = new Set<string>();
  for (const file of filesBelow(appRoot).filter((candidate) => path.basename(candidate) === "rbac-actor.ts")) {
    for (const [name, fn] of topLevelFunctions(parse(file))) {
      if (fn.exported && name.startsWith("authorize") && [...calledNames(fn.node)].some((called) => CORE_GUARDS.has(called))) actorGuards.add(name);
    }
  }

  const actionFiles = filesBelow(appRoot)
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => isUseServerFile(parse(file)) || /(^|-)actions\.ts$/.test(path.basename(file)));

  it("finds the Server Action files (actions.ts, *-actions.ts and every \"use server\" module)", () => {
    expect(actionFiles.length).toBeGreaterThanOrEqual(20);
    // Every file named like an action file really is a Server Action module (and vice versa).
    for (const file of actionFiles) expect(isUseServerFile(parse(file)), path.relative(appRoot, file)).toBe(true);
    expect(actorGuards).toStrictEqual(new Set(["authorizePlatformActor", "authorizeTenantActor", "authorizeCustomerActor"]));
  });

  it("each exported action calls an authorize* guard, unless it is on the session-only allow-list", () => {
    const unguarded: string[] = [];
    const seenAllowed = new Set<string>();
    for (const file of actionFiles) {
      const relative = path.relative(appRoot, file).split(path.sep).join("/");
      const source   = parse(file);
      const guards   = guardNamesOf(source, actorGuards);
      const allowed  = SESSION_ONLY_ACTIONS[relative] ?? [];
      for (const [name, fn] of topLevelFunctions(source)) {
        if (!fn.exported) continue;
        if (allowed.includes(name)) {
          seenAllowed.add(`${relative}#${name}`);
          continue;
        }
        if (![...calledNames(fn.node)].some((called) => guards.has(called))) unguarded.push(`${relative}#${name}`);
      }
    }
    expect(unguarded).toStrictEqual([]);
    // The allow-list holds no stale entries.
    const listed = Object.entries(SESSION_ONLY_ACTIONS).flatMap(([file, names]) => names.map((name) => `${file}#${name}`));
    expect([...seenAllowed].sort()).toStrictEqual(listed.sort());
  });

  it("every privilege an action names exists in the catalog and belongs to its own panel's domain", () => {
    const problems: string[] = [];
    for (const file of actionFiles) {
      const relative = path.relative(appRoot, file).split(path.sep).join("/");
      const domain   = relative.startsWith("platform/") ? "platform" : relative.startsWith("(workspace)/tenant/") ? "tenant" : relative.startsWith("(workspace)/customer/") ? "customer" : null;
      for (const key of authorizeLiterals(parse(file))) {
        const permission = getPermission(key);
        if (!permission || permission.domain !== domain) problems.push(`${relative}: ${key}`);
      }
    }
    expect(problems).toStrictEqual([]);
  });
});

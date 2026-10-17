/**
 * RBAC enforcement of the EXISTING features, invoked the way Next.js invokes
 * them (.vibe/memory/role-privilege-management.md, "Enforcement map"): every
 * tenant, registration and appearance Server Action of the Platform console
 * and the tenant area refuses without its privilege (friendly message +
 * `authz.denied` audit row) and passes the privilege check with it; a revoked
 * privilege, a disabled role, a switched-off module or a changed role applies
 * on the very next call; the fingerprint actions change with the privileges
 * and never move `last_used_at`; the tenant registrations page renders the
 * access-denied state.
 *
 * Real scratch control plane and a REAL provisioned tenant database; only the
 * request plumbing of Next.js (cookies, headers, redirect, cache, after) and
 * the Host-header tenant lookup are replaced.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { permissionKeysOfDomain } from "@/lib/authz/catalog";
import { FORBIDDEN_MESSAGE, NO_ACTIVE_ROLE_MESSAGE } from "@/lib/authz/resolver";
import { loadTenantDatabase } from "@/lib/tenants/database-target";
import type { ReadyWorkspace } from "@/lib/workspace/context";
import { createUserSession, hashWorkspaceToken } from "@/lib/workspace/sessions";
import { closeAppDatabase } from "./support/app-connections";
import {
  clearPlatformTables,
  clearTenantTables,
  connectToTestDatabase,
  insertOwner,
  insertPlatformRole,
  insertSession,
  sha256Hex,
} from "./support/postgres";
import { connectAs, TenantResources } from "./support/tenant-resources";
import { createProvisionedTenant, readyWorkspace, type ProvisionedTenant } from "./support/workspace";

// Provisioning a real tenant database takes a while.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

// ---------------------------------------------------------------------------
// The request plumbing of Next.js.

// The client address the mocked request carries (also hard-coded in the hoisted mock below).
const CLIENT_IP = "203.0.113.77";
const mocks = vi.hoisted(() => ({
  /** Cookie name → value of the "current request". */
  cookies: new Map<string, string>(),
  /** The ready workspace the Host header would resolve to. */
  workspace: null as unknown,
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.cookies.has(name) ? { name, value: mocks.cookies.get(name) } : undefined),
  }),
  headers: async () =>
    new Headers({
      host: "platform.test",
      origin: "http://platform.test",
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": "203.0.113.77",
    }),
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
import {
  createTenantAction,
  loadTenantCountRecordsAction,
  previewTenantValuesAction,
  reactivateTenantAction,
  retryProvisioningAction,
  suspendTenantAction,
  testDatabaseConnectionAction,
} from "@/app/platform/(console)/tenants/actions";
import {
  recheckSubdomainAction,
  resetMasterPasswordAction,
  rotateDatabasePasswordAction,
  updateDatabasePasswordAction,
  updateTenantAction,
  verifyCustomDomainAction,
} from "@/app/platform/(console)/tenants/manage-actions";
import {
  approvePlatformRegistrationAction,
  loadPlatformRegistrationRecordsAction,
  reactivatePlatformCustomerAction,
  rejectPlatformRegistrationAction,
  suspendPlatformCustomerAction,
} from "@/app/platform/(console)/tenants/[id]/registrations/actions";
import { updateAppearanceAction } from "@/app/platform/(console)/settings/appearance/actions";
import { saveTenantAppearanceAction, tenantFingerprintAction } from "@/app/(workspace)/tenant/actions";
import {
  approveTenantRegistrationAction,
  loadTenantRegistrationRecordsAction,
  reactivateTenantCustomerAction,
  rejectTenantRegistrationAction,
  suspendTenantCustomerAction,
} from "@/app/(workspace)/tenant/registrations/actions";
import TenantRegistrationsPage from "@/app/(workspace)/tenant/registrations/page";
import { tenantDashboardConfig } from "@/app/(workspace)/tenant/navigation";
import { customerDashboardConfig } from "@/app/(workspace)/customer/(portal)/navigation";
import { AccessDenied } from "@/components/shared/access-denied";

const PLATFORM_COOKIE = "md_platform_session";
const TENANT_COOKIE   = "md_tenant_session";
const HASH            = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo";

let control: Client;
let resources: TenantResources;
let tenant: ProvisionedTenant;
let ws: ReadyWorkspace;
let rt: Client;

beforeAll(async () => {
  control = await connectToTestDatabase();
  await clearPlatformTables(control);
  await clearTenantTables(control);
  resources = await TenantResources.open(control);
  tenant    = await createProvisionedTenant("rbacenf", { ownerId: randomUUID(), ipAddress: "203.0.113.211" });
  ws        = await readyWorkspace(tenant);
  mocks.workspace = ws;
  const target = await loadTenantDatabase(tenant.id);
  rt = await connectAs({ database: target.database, user: target.user, password: target.password, port: target.port });
});

beforeEach(() => {
  mocks.cookies.clear();
});

afterAll(async () => {
  await rt?.end().catch(() => undefined);
  await ws?.db.$disconnect().catch(() => undefined);
  await resources.cleanup();
  await clearTenantTables(control);
  await clearPlatformTables(control);
  await control.query("DELETE FROM platform_appearance").catch(() => undefined);
  await resources.close();
  await control.end();
  await closeAppDatabase();
});

// ---------------------------------------------------------------------------
// Helpers

/** A fresh token shaped like the real ones (43 base64url characters). */
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** A platform owner holding the given role (Master Platform when omitted), signed in for this "request". */
async function signedInOwner(roleId?: string): Promise<{ ownerId: string; token: string }> {
  const ownerId = await insertOwner(control, {
    username: `vt-enf-${randomBytes(4).toString("hex")}`,
    passwordHash: HASH,
    ...(roleId ? { roleId } : {}),
  });
  const token = newToken();
  await insertSession(control, { ownerId, tokenHash: sha256Hex(token), lastUsedMinutesAgo: 5 });
  mocks.cookies.set(PLATFORM_COOKIE, token);
  return { ownerId, token };
}

/** A custom platform role with exactly these privileges. */
async function platformRole(keys: string[]): Promise<string> {
  return insertPlatformRole(control, { name: `VT enf ${randomBytes(4).toString("hex")}`, permissionKeys: keys });
}

/** How many authz.denied rows exist for this actor and privilege. */
async function denials(actorId: string, permission: string, tenantId: string | null = null): Promise<number> {
  const result = await control.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM audit_events
     WHERE action = 'authz.denied' AND actor_id = $1 AND target_id = $2
       AND tenant_id IS NOT DISTINCT FROM $3::uuid`,
    [actorId, permission, tenantId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** The message a refusal carries, whatever the action's error shape is. */
function refusalMessage(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const record = result as Record<string, unknown>;
  for (const key of ["message", "error", "formError"]) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  return undefined;
}

/** True when a rendered element tree contains the AccessDenied component. */
function containsAccessDenied(node: ReactNode): boolean {
  if (Array.isArray(node)) return node.some(containsAccessDenied);
  if (!isValidElement(node)) return false;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === AccessDenied) return true;
  return containsAccessDenied(element.props.children);
}

/** One row value of a query on the tenant database. */
async function one(sql: string, values: unknown[] = []): Promise<string> {
  const result = await rt.query<{ id: string }>(sql, values);
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`no row: ${sql}`);
  return id;
}

/** A custom tenant role with exactly these privileges (written as the runtime login). */
async function tenantRole(keys: string[]): Promise<string> {
  const id = await one(
    `INSERT INTO roles (id, name, domain, status, updated_at)
     VALUES (gen_random_uuid(), $1, 'tenant'::authz_domain, 'active'::role_status, now()) RETURNING id`,
    [`VT enf ${randomBytes(4).toString("hex")}`],
  );
  await rt.query(
    "INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE key = ANY($2::text[])",
    [id, keys],
  );
  return id;
}

/** A tenant staff user holding the given role, signed in for this "request". */
async function signedInStaff(roleId: string | null): Promise<{ userId: string; token: string }> {
  const handle = `vt-enf-${randomBytes(3).toString("hex")}`;
  const userId = await one(
    `INSERT INTO users (id, email, username, password_hash, name, updated_at)
     VALUES (gen_random_uuid(), $1, $2, 'h', 'VT staff', now()) RETURNING id`,
    [`${handle}@example.com`, handle],
  );
  if (roleId) await rt.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [userId, roleId]);
  const token = await createUserSession(ws.db, tenant.id, userId, "tenant");
  mocks.cookies.set(TENANT_COOKIE, token);
  return { userId, token };
}

// ---------------------------------------------------------------------------
// The platform actions and the privilege each needs.

type PlatformCase = [name: string, permission: string, run: () => Promise<unknown>];

const missingTenant = randomUUID();
const PLATFORM_ACTIONS: PlatformCase[] = [
  ["createTenantAction", "platform.tenants.create", () => createTenantAction({ status: "idle" }, new FormData())],
  ["previewTenantValuesAction", "platform.tenants.create", () => previewTenantValuesAction("Vt Preview")],
  [
    "testDatabaseConnectionAction",
    "platform.tenants.create",
    () => testDatabaseConnectionAction({ databaseName: "", databaseUser: "", databasePassword: "", databasePort: "" }),
  ],
  ["suspendTenantAction", "platform.tenants.suspend", () => suspendTenantAction(missingTenant, "Reason text")],
  ["reactivateTenantAction", "platform.tenants.suspend", () => reactivateTenantAction(missingTenant)],
  ["retryProvisioningAction", "platform.tenants.provision", () => retryProvisioningAction(missingTenant)],
  [
    "loadTenantCountRecordsAction",
    "platform.tenants.view",
    () => loadTenantCountRecordsAction({ kind: "summary", category: "all" }, 1),
  ],
  ["updateTenantAction", "platform.tenants.edit", () => updateTenantAction(missingTenant, { status: "idle" }, new FormData())],
  ["verifyCustomDomainAction", "platform.tenants.edit", () => verifyCustomDomainAction(missingTenant)],
  ["recheckSubdomainAction", "platform.tenants.edit", () => recheckSubdomainAction(missingTenant)],
  ["resetMasterPasswordAction", "platform.tenants.credentials", () => resetMasterPasswordAction(missingTenant, { mode: "auto" })],
  ["rotateDatabasePasswordAction", "platform.tenants.credentials", () => rotateDatabasePasswordAction(missingTenant)],
  [
    "updateDatabasePasswordAction",
    "platform.tenants.credentials",
    () => updateDatabasePasswordAction(missingTenant, "Vt-Password-123456"),
  ],
  [
    "loadPlatformRegistrationRecordsAction",
    "platform.tenant_registrations.view",
    () => loadPlatformRegistrationRecordsAction(missingTenant, "all", 1),
  ],
  [
    "approvePlatformRegistrationAction",
    "platform.tenant_registrations.review",
    () => approvePlatformRegistrationAction(missingTenant, randomUUID()),
  ],
  [
    "rejectPlatformRegistrationAction",
    "platform.tenant_registrations.review",
    () => rejectPlatformRegistrationAction(missingTenant, randomUUID(), "Not a fit"),
  ],
  [
    "suspendPlatformCustomerAction",
    "platform.tenant_registrations.suspend",
    () => suspendPlatformCustomerAction(missingTenant, randomUUID()),
  ],
  [
    "reactivatePlatformCustomerAction",
    "platform.tenant_registrations.suspend",
    () => reactivatePlatformCustomerAction(missingTenant, randomUUID()),
  ],
  [
    "updateAppearanceAction (global)",
    "platform.appearance.manage_global",
    () => updateAppearanceAction({ operation: "reset", scope: "global" }),
  ],
];

describe("platform Server Actions", () => {
  it.each(PLATFORM_ACTIONS)("%s refuses without %s and audits authz.denied", async (_name, permission, run) => {
    // Every platform privilege except the one this action needs.
    const others = permissionKeysOfDomain("platform").filter((key) => key !== permission);
    const { ownerId } = await signedInOwner(await platformRole(others));

    const result = await run();

    expect(refusalMessage(result)).toBe(FORBIDDEN_MESSAGE);
    expect(await denials(ownerId, permission)).toBe(1);
    // The audit row records the client address of the refused request.
    const ip = await control.query<{ ip: string }>(
      "SELECT host(ip_address) AS ip FROM audit_events WHERE action = 'authz.denied' AND actor_id = $1",
      [ownerId],
    );
    expect(ip.rows[0]?.ip).toBe(CLIENT_IP);
  });

  it.each(PLATFORM_ACTIONS)("%s passes the privilege check with %s", async (_name, permission, run) => {
    const { ownerId } = await signedInOwner(await platformRole([permission]));

    const result = await run();

    // The action ran past authorization (its own validation / not-found answer is fine).
    expect(refusalMessage(result)).not.toBe(FORBIDDEN_MESSAGE);
    expect(await denials(ownerId, permission)).toBe(0);
  });

  it("a disabled role gets the no-active-role message", async () => {
    const role = await platformRole(["platform.tenants.view"]);
    const { ownerId } = await signedInOwner(role);
    await control.query("UPDATE platform_roles SET status = 'disabled' WHERE id = $1", [role]);

    const result = await loadTenantCountRecordsAction({ kind: "summary", category: "all" }, 1);

    expect(result).toStrictEqual({ ok: false, message: NO_ACTIVE_ROLE_MESSAGE });
    expect(await denials(ownerId, "platform.tenants.view")).toBe(1);
  });
});

describe("platform: changes apply on the next request", () => {
  const countRecords = () => loadTenantCountRecordsAction({ kind: "summary", category: "all" }, 1);

  it("revoking the privilege, changing the role or disabling the role denies the next call", async () => {
    const viewer = await platformRole(["platform.tenants.view"]);
    const other  = await platformRole(["platform.roles.view"]);
    const { ownerId } = await signedInOwner(viewer);
    expect(await countRecords()).toMatchObject({ ok: true });

    // 1. The privilege is revoked from the role.
    await control.query("DELETE FROM platform_role_permissions WHERE role_id = $1", [viewer]);
    expect(await countRecords()).toStrictEqual({ ok: false, message: FORBIDDEN_MESSAGE });

    // 2. Granted again, then the owner gets another role.
    await control.query("INSERT INTO platform_role_permissions (role_id, permission_key) VALUES ($1, 'platform.tenants.view')", [viewer]);
    expect(await countRecords()).toMatchObject({ ok: true });
    await control.query("UPDATE platform_owners SET role_id = $2 WHERE id = $1", [ownerId, other]);
    expect(await countRecords()).toStrictEqual({ ok: false, message: FORBIDDEN_MESSAGE });

    // 3. Back on the viewer role, which is then disabled.
    await control.query("UPDATE platform_owners SET role_id = $2 WHERE id = $1", [ownerId, viewer]);
    expect(await countRecords()).toMatchObject({ ok: true });
    await control.query("UPDATE platform_roles SET status = 'disabled' WHERE id = $1", [viewer]);
    expect(await countRecords()).toStrictEqual({ ok: false, message: NO_ACTIVE_ROLE_MESSAGE });
  });

  it("switching the module off denies even Master Platform on the next call", async () => {
    await signedInOwner();
    expect(await countRecords()).toMatchObject({ ok: true });
    await control.query("INSERT INTO platform_module_settings (module_key, enabled) VALUES ('platform.tenants', false)");
    try {
      expect(await countRecords()).toStrictEqual({ ok: false, message: FORBIDDEN_MESSAGE });
    } finally {
      await control.query("DELETE FROM platform_module_settings");
    }
    expect(await countRecords()).toMatchObject({ ok: true });
  });

  it("the fingerprint action follows the privileges and never moves last_used_at", async () => {
    const role = await platformRole(["platform.tenants.view"]);
    const { token } = await signedInOwner(role);
    const lastUsed = async () =>
      (await control.query<{ t: Date }>("SELECT last_used_at AS t FROM platform_owner_sessions WHERE token_hash = $1", [sha256Hex(token)]))
        .rows[0]?.t.getTime();
    const before = await lastUsed();

    const first = await platformFingerprintAction();
    expect(first).toStrictEqual({ signedIn: true, fingerprint: expect.any(String) });
    expect(Object.keys(first).sort()).toEqual(["fingerprint", "signedIn"]);

    await control.query("INSERT INTO platform_role_permissions (role_id, permission_key) VALUES ($1, 'platform.tenants.create')", [role]);
    const second = await platformFingerprintAction();
    expect(second.signedIn).toBe(true);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(await lastUsed()).toBe(before);

    mocks.cookies.delete(PLATFORM_COOKIE);
    expect(await platformFingerprintAction()).toStrictEqual({ signedIn: false, fingerprint: null });
  });
});

// ---------------------------------------------------------------------------
// The tenant area.

type TenantCase = [name: string, permission: string, run: () => Promise<unknown>];

const TENANT_ACTIONS: TenantCase[] = [
  ["loadTenantRegistrationRecordsAction", "tenant.registrations.view", () => loadTenantRegistrationRecordsAction("all", 1)],
  ["approveTenantRegistrationAction", "tenant.registrations.review", () => approveTenantRegistrationAction(randomUUID())],
  ["rejectTenantRegistrationAction", "tenant.registrations.review", () => rejectTenantRegistrationAction(randomUUID(), "Not a fit")],
  ["suspendTenantCustomerAction", "tenant.registrations.suspend", () => suspendTenantCustomerAction(randomUUID())],
  ["reactivateTenantCustomerAction", "tenant.registrations.suspend", () => reactivateTenantCustomerAction(randomUUID())],
  [
    "saveTenantAppearanceAction (workspace)",
    "tenant.appearance.manage_workspace",
    () => saveTenantAppearanceAction({ operation: "reset", scope: "workspace" }),
  ],
];

describe("tenant Server Actions", () => {
  it.each(TENANT_ACTIONS)("%s refuses without %s and audits authz.denied", async (_name, permission, run) => {
    const others = permissionKeysOfDomain("tenant").filter((key) => key !== permission);
    const { userId } = await signedInStaff(await tenantRole(others));

    const result = await run();

    expect(refusalMessage(result)).toBe(FORBIDDEN_MESSAGE);
    expect(await denials(userId, permission, tenant.id)).toBe(1);
  });

  it.each(TENANT_ACTIONS)("%s passes the privilege check with %s", async (_name, permission, run) => {
    const { userId } = await signedInStaff(await tenantRole([permission]));

    const result = await run();

    expect(refusalMessage(result)).not.toBe(FORBIDDEN_MESSAGE);
    expect(await denials(userId, permission, tenant.id)).toBe(0);
  });

  it("personal appearance needs no privilege, even without a role", async () => {
    await signedInStaff(null);
    const result = await saveTenantAppearanceAction({ operation: "reset", scope: "personal" });
    expect(result).toMatchObject({ ok: true });
  });
});

describe("tenant registrations page", () => {
  const render = () => TenantRegistrationsPage({ searchParams: Promise.resolve({}) });

  it("shows the access-denied state without tenant.registrations.view and the list with it", async () => {
    await signedInStaff(await tenantRole(["tenant.users.view"]));
    expect(containsAccessDenied(await render())).toBe(true);

    await signedInStaff(await tenantRole(["tenant.registrations.view"]));
    expect(containsAccessDenied(await render())).toBe(false);
  });

  it("a staff user without a role sees the access-denied state", async () => {
    await signedInStaff(null);
    expect(containsAccessDenied(await render())).toBe(true);
  });
});

describe("tenant: changes apply on the next request", () => {
  const records = () => loadTenantRegistrationRecordsAction("all", 1);

  it("revoked privilege, changed role and disabled module deny the next call", async () => {
    const clerk = await tenantRole(["tenant.registrations.view"]);
    const other = await tenantRole(["tenant.users.view"]);
    const { userId } = await signedInStaff(clerk);
    expect(await records()).toMatchObject({ ok: true });

    // 1. Privilege revoked from the role.
    await rt.query("DELETE FROM role_permissions WHERE role_id = $1", [clerk]);
    expect(await records()).toStrictEqual({ ok: false, error: FORBIDDEN_MESSAGE });

    // 2. Granted back; then the user's role changes.
    await rt.query(
      "INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE key = 'tenant.registrations.view'",
      [clerk],
    );
    expect(await records()).toMatchObject({ ok: true });
    await rt.query("UPDATE user_roles SET role_id = $2 WHERE user_id = $1", [userId, other]);
    expect(await records()).toStrictEqual({ ok: false, error: FORBIDDEN_MESSAGE });

    // 3. Back on the clerk role; the Platform Owner switches the module off for this tenant.
    await rt.query("UPDATE user_roles SET role_id = $2 WHERE user_id = $1", [userId, clerk]);
    expect(await records()).toMatchObject({ ok: true });
    await control.query(
      "INSERT INTO tenant_module_settings (tenant_id, module_key, enabled) VALUES ($1, 'tenant.registrations', false)",
      [tenant.id],
    );
    try {
      expect(await records()).toStrictEqual({ ok: false, error: FORBIDDEN_MESSAGE });
    } finally {
      await control.query("DELETE FROM tenant_module_settings WHERE tenant_id = $1", [tenant.id]);
    }
    expect(await records()).toMatchObject({ ok: true });
  });

  it("the tenant fingerprint action follows the privileges and never moves last_used_at", async () => {
    const role = await tenantRole(["tenant.users.view"]);
    const { token } = await signedInStaff(role);
    // Older than the touch interval, so a touching validation would update it.
    const tokenHash = hashWorkspaceToken(tenant.id, "tenant", token);
    await rt.query("UPDATE user_sessions SET last_used_at = now() - interval '5 minutes' WHERE token_hash = $1", [tokenHash]);
    const lastUsed = async () =>
      (await rt.query<{ t: Date }>("SELECT last_used_at AS t FROM user_sessions WHERE token_hash = $1", [tokenHash])).rows[0]?.t.getTime();
    const before = await lastUsed();

    const first = await tenantFingerprintAction();
    expect(first).toStrictEqual({ signedIn: true, fingerprint: expect.any(String) });

    await rt.query(
      "INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE key = 'tenant.roles.view'",
      [role],
    );
    const second = await tenantFingerprintAction();
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(await lastUsed()).toBe(before);

    mocks.cookies.delete(TENANT_COOKIE);
    expect(await tenantFingerprintAction()).toStrictEqual({ signedIn: false, fingerprint: null });
  });
});

// ---------------------------------------------------------------------------
// Navigation of the workspace areas (pure).

describe("workspace navigation by privilege", () => {
  const user = { name: "Vt", username: "vt", email: "vt@example.com", role: { name: "Clerk" } };
  const grant = (keys: string[]) => (key: string) => keys.includes(key);

  it("tenant: Registrations, its quick action and Access control follow the privileges; the menu names the role", () => {
    const none = tenantDashboardConfig("T", user, { roleState: "active", can: grant([]) });
    expect(none.navMain.map((item) => item.title)).toEqual(["Dashboard"]);
    expect(none.quickAction).toBeUndefined();
    expect(none.navGroups.map((group) => group.label)).toEqual(["Catalog", "Business"]);
    expect(none.user.roleLabel).toBe("Clerk");

    const all = tenantDashboardConfig("T", user, {
      roleState: "active",
      can: grant(["tenant.registrations.view", "tenant.users.view", "tenant.roles.view"]),
    });
    expect(all.navMain.map((item) => item.href)).toEqual(["/tenant/dashboard", "/tenant/registrations"]);
    expect(all.quickAction?.href).toBe("/tenant/registrations?status=pending");
    expect(all.navGroups.at(-1)).toMatchObject({
      label: "Access control",
      items: [{ title: "Sub-Tenants", href: "/tenant/users" }, { title: "Roles & Privileges", href: "/tenant/roles" }],
    });

    expect(tenantDashboardConfig("T", user, { roleState: "disabled", can: grant([]) }).user.roleLabel).toBe("No active role");
  });

  it("customer: the Account group follows the privileges; the menu shows role and account type", () => {
    const customerUser = { ...user, customer: { type: "artist" as const } };
    const none = customerDashboardConfig("T", customerUser, { roleState: "missing", can: grant([]) });
    expect(none.navGroups.map((group) => group.label)).toEqual(["Music", "Earnings"]);
    expect(none.user.roleLabel).toBe("No active role · Artist");

    const all = customerDashboardConfig("T", customerUser, {
      roleState: "active",
      can: grant(["customer.sub_customers.view", "customer.roles.view"]),
    });
    expect(all.navGroups.at(-1)).toMatchObject({
      label: "Account",
      items: [{ href: "/customer/sub-customers" }, { href: "/customer/roles" }],
    });
    expect(all.user.roleLabel).toBe("Clerk · Artist");
  });
});

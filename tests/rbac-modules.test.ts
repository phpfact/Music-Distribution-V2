/**
 * Central module switches (.vibe/memory/role-privilege-management.md,
 * "Module switches"), invoked the way Next.js invokes the Server Actions:
 *
 *   - switching needs its privilege (refused + `authz.denied` audit without it);
 *   - core, unknown and cross-domain module keys are refused (and audited as
 *     `authz.escalation_blocked`); malformed input is refused;
 *   - switching `platform.tenants` off removes every `platform.tenants.*`
 *     privilege from a Master Platform owner on the very next read, and
 *     switching it on restores them;
 *   - switching `tenant.registrations` off for tenant A removes it from A's
 *     Master Tenant, while tenant B keeps it;
 *   - real changes write `platform_module.*` / `tenant_module.*` audit rows;
 *     a no-op writes nothing.
 *
 * Real scratch control plane and ONE real provisioned tenant database (tenant
 * B is a plain control-plane row: the switches live in the control plane);
 * only the request plumbing of Next.js is replaced.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_INVALID_MESSAGE, MODULE_TENANT_NOT_FOUND_MESSAGE } from "@/lib/authz/module-model";
import { FORBIDDEN_MESSAGE } from "@/lib/authz/resolver";
import { getControlDb } from "@/lib/db/control";
import type { ReadyWorkspace } from "@/lib/workspace/context";
import { createUserSession, validateUserSession } from "@/lib/workspace/sessions";
import { closeAppDatabase } from "./support/app-connections";
import {
  clearPlatformTables,
  clearTenantTables,
  connectToTestDatabase,
  insertOwner,
  insertPlatformRole,
  insertSession,
  insertTenant,
  sha256Hex,
} from "./support/postgres";
import { TenantResources } from "./support/tenant-resources";
import { createProvisionedTenant, readyWorkspace, type ProvisionedTenant } from "./support/workspace";

// Provisioning a real tenant database takes a while.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

// ---------------------------------------------------------------------------
// The request plumbing of Next.js.

const mocks = vi.hoisted(() => ({
  /** Cookie name → value of the "current request". */
  cookies: new Map<string, string>(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
  revalidatePath: vi.fn(),
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
      "x-forwarded-for": "203.0.113.78",
    }),
}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/server", () => ({ after: vi.fn() }));

// Imported after the mocks.
import { setPlatformModuleAction } from "@/app/platform/(console)/settings/modules/actions";
import { setTenantModuleAction } from "@/app/platform/(console)/tenants/[id]/module-actions";
import { listPlatformModules, listTenantModules } from "@/lib/authz/module-service";
import { loadPlatformAccess } from "@/lib/authz/platform-access";
import { loadDisabledTenantModules, resolveWorkspaceAccess } from "@/lib/authz/workspace-access";

const PLATFORM_COOKIE = "md_platform_session";
const HASH            = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo";
const CLIENT_IP       = "203.0.113.78";

let control: Client;
let resources: TenantResources;
let tenant: ProvisionedTenant;
let ws: ReadyWorkspace;
let tenantB: string;

beforeAll(async () => {
  control = await connectToTestDatabase();
  await clearPlatformTables(control);
  await clearTenantTables(control);
  resources = await TenantResources.open(control);
  tenant    = await createProvisionedTenant("rbacmod", { ownerId: randomUUID(), ipAddress: "203.0.113.212" });
  ws        = await readyWorkspace(tenant);
  tenantB   = await insertTenant(control, { slug: `rbacmod-b-${randomBytes(3).toString("hex")}` });
});

beforeEach(async () => {
  mocks.cookies.clear();
  mocks.revalidatePath.mockClear();
  // Every test starts with every module switched on.
  await control.query("DELETE FROM platform_module_settings");
  await control.query("DELETE FROM tenant_module_settings");
});

afterAll(async () => {
  await ws?.db.$disconnect().catch(() => undefined);
  await resources.cleanup();
  await clearTenantTables(control);
  await clearPlatformTables(control);
  await resources.close();
  await control.end();
  await closeAppDatabase();
});

// ---------------------------------------------------------------------------
// Helpers

/** A platform owner holding the given role (Master Platform when omitted), signed in for this "request". */
async function signedInOwner(roleId?: string): Promise<string> {
  const ownerId = await insertOwner(control, {
    username: `vt-mod-${randomBytes(4).toString("hex")}`,
    passwordHash: HASH,
    ...(roleId ? { roleId } : {}),
  });
  const token = randomBytes(32).toString("base64url");
  await insertSession(control, { ownerId, tokenHash: sha256Hex(token), lastUsedMinutesAgo: 5 });
  mocks.cookies.set(PLATFORM_COOKIE, token);
  return ownerId;
}

/** A custom platform role with exactly these privileges. */
async function platformRole(keys: string[]): Promise<string> {
  return insertPlatformRole(control, { name: `VT mod ${randomBytes(4).toString("hex")}`, permissionKeys: keys });
}

/** The audit rows of one actor and action: target, tenant, metadata and address. */
async function auditRows(actorId: string, action: string) {
  const result = await control.query<{
    target_type: string | null;
    target_id: string | null;
    tenant_id: string | null;
    metadata: Record<string, unknown> | null;
    ip_address: string | null;
  }>(
    `SELECT target_type, target_id, tenant_id, metadata, host(ip_address) AS ip_address
     FROM audit_events WHERE actor_id = $1 AND action = $2 ORDER BY occurred_at`,
    [actorId, action],
  );
  return result.rows;
}

/** How many module setting rows exist (both tables). */
async function settingRows(): Promise<number> {
  const result = await control.query<{ count: string }>(
    "SELECT ((SELECT count(*) FROM platform_module_settings) + (SELECT count(*) FROM tenant_module_settings))::text AS count",
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** The tenant's Master Tenant admin as the guards see it (role + privilege keys from the session query). */
async function masterTenantUser() {
  const row = await ws.db.user.findFirst({ where: { username: tenant.adminUsername }, select: { id: true } });
  if (!row) throw new Error("the provisioned admin is missing");
  const token = await createUserSession(ws.db, tenant.id, row.id, "tenant");
  const user  = await validateUserSession(ws.db, tenant.id, "tenant", token, { touch: false });
  if (!user) throw new Error("the admin session did not validate");
  return user;
}

// ---------------------------------------------------------------------------

describe("switching needs its privilege", () => {
  it("the platform switch is refused and audited without platform.modules.manage", async () => {
    const ownerId = await signedInOwner(await platformRole(["platform.tenants.view", "platform.tenant_modules.manage"]));
    const result  = await setPlatformModuleAction("platform.tenants", false);
    expect(result).toStrictEqual({ ok: false, reason: "forbidden", error: FORBIDDEN_MESSAGE });
    const denied = await auditRows(ownerId, "authz.denied");
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ target_id: "platform.modules.manage", ip_address: CLIENT_IP });
    expect(await settingRows()).toBe(0);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("the tenant switch is refused and audited without platform.tenant_modules.manage", async () => {
    const ownerId = await signedInOwner(await platformRole(["platform.tenants.view", "platform.modules.manage"]));
    const result  = await setTenantModuleAction(tenant.id, "tenant.registrations", false);
    expect(result).toStrictEqual({ ok: false, reason: "forbidden", error: FORBIDDEN_MESSAGE });
    const denied = await auditRows(ownerId, "authz.denied");
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ target_id: "platform.tenant_modules.manage" });
    expect(await settingRows()).toBe(0);
  });

  it("a signed-out caller is sent to the login page", async () => {
    await expect(setPlatformModuleAction("platform.tenants", false)).rejects.toThrow("NEXT_REDIRECT /platform/login");
    await expect(setTenantModuleAction(tenant.id, "tenant.registrations", false)).rejects.toThrow(
      "NEXT_REDIRECT /platform/login",
    );
  });
});

describe("tampered and malformed requests are refused", () => {
  it.each([
    ["a core module", "platform.roles", "core_module"],
    ["the core module switch itself", "platform.modules", "core_module"],
    ["an unknown module", "platform.nothing_here", "unknown_module"],
    ["a tenant module", "tenant.registrations", "other_domain_module"],
  ])("platform: %s is refused and audited as an escalation attempt", async (_name, key, attempt) => {
    const ownerId = await signedInOwner();
    expect(await setPlatformModuleAction(key, false)).toStrictEqual({ ok: false, reason: "invalid", error: MODULE_INVALID_MESSAGE });
    const blocked = await auditRows(ownerId, "authz.escalation_blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ target_type: "module", target_id: key, tenant_id: null, metadata: { attempt, scope: "platform" } });
    expect(await settingRows()).toBe(0);
  });

  it.each([
    ["a core tenant module", "tenant.roles", "core_module"],
    ["a core customer module", "customer.sub_customers", "core_module"],
    ["a platform module", "platform.tenants", "other_domain_module"],
    ["an unknown module", "tenant.nothing_here", "unknown_module"],
  ])("tenant: %s is refused and audited with the tenant", async (_name, key, attempt) => {
    const ownerId = await signedInOwner();
    expect(await setTenantModuleAction(tenant.id, key, false)).toStrictEqual({
      ok: false,
      reason: "invalid",
      error: MODULE_INVALID_MESSAGE,
    });
    const blocked = await auditRows(ownerId, "authz.escalation_blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ target_id: key, tenant_id: tenant.id, metadata: { attempt, scope: "tenant" } });
    expect(await settingRows()).toBe(0);
  });

  it("malformed values are refused without touching anything", async () => {
    const ownerId = await signedInOwner();
    for (const [key, enabled] of [
      ["platform.tenants", "false"],
      ["platform.tenants", null],
      [42, false],
      ["", true],
    ] as const) {
      expect(await setPlatformModuleAction(key, enabled)).toMatchObject({ ok: false, reason: "invalid" });
    }
    expect(await setTenantModuleAction("not-a-uuid", "tenant.registrations", false)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await setTenantModuleAction(tenant.id, "tenant.registrations", 0)).toMatchObject({ ok: false, reason: "invalid" });
    // A well-formed id of a tenant that does not exist.
    expect(await setTenantModuleAction(randomUUID(), "tenant.registrations", false)).toStrictEqual({
      ok: false,
      reason: "not_found",
      error: MODULE_TENANT_NOT_FOUND_MESSAGE,
    });
    // Malformed input is not an escalation attempt; nothing was stored.
    expect(await auditRows(ownerId, "authz.escalation_blocked")).toHaveLength(0);
    expect(await settingRows()).toBe(0);
  });
});

describe("platform modules", () => {
  it("switching platform.tenants off removes its privileges from Master Platform on the next read; on restores them", async () => {
    const ownerId = await signedInOwner();
    const tenantKeys = (keys: readonly string[]) => keys.filter((key) => key.startsWith("platform.tenants."));

    // Before: Master Platform holds every platform.tenants.* privilege.
    const before = await loadPlatformAccess(getControlDb(), ownerId);
    expect(tenantKeys(before.permissions)).toHaveLength(6);

    // Off: the very next read has none of them (other modules untouched).
    const off = await setPlatformModuleAction("platform.tenants", false);
    expect(off).toMatchObject({ ok: true, changed: true, module: { key: "platform.tenants", enabled: false, core: false } });
    const during = await loadPlatformAccess(getControlDb(), ownerId);
    expect(tenantKeys(during.permissions)).toStrictEqual([]);
    expect(during.can("platform.tenants.view")).toBe(false);
    expect(during.can("platform.modules.manage")).toBe(true);
    expect(during.fingerprint).not.toBe(before.fingerprint);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/platform", "layout");

    // Stored with who changed it; listed as off.
    const stored = await control.query("SELECT enabled, updated_by_id FROM platform_module_settings WHERE module_key = 'platform.tenants'");
    expect(stored.rows).toStrictEqual([{ enabled: false, updated_by_id: ownerId }]);
    expect((await listPlatformModules(getControlDb())).find((module) => module.key === "platform.tenants")?.enabled).toBe(false);

    // Off again: nothing changes, nothing is audited.
    expect(await setPlatformModuleAction("platform.tenants", false)).toMatchObject({ ok: true, changed: false });

    // On: the privileges come back on the next read.
    expect(await setPlatformModuleAction("platform.tenants", true)).toMatchObject({ ok: true, changed: true, module: { enabled: true } });
    const after = await loadPlatformAccess(getControlDb(), ownerId);
    expect(tenantKeys(after.permissions)).toHaveLength(6);
    expect(after.fingerprint).toBe(before.fingerprint);

    // Exactly one audit row per real change, with the module and client address.
    expect(await auditRows(ownerId, "platform_module.disabled")).toStrictEqual([
      { target_type: "module", target_id: "platform.tenants", tenant_id: null, metadata: { moduleKey: "platform.tenants" }, ip_address: CLIENT_IP },
    ]);
    expect(await auditRows(ownerId, "platform_module.enabled")).toHaveLength(1);
  });

  it("lists every platform module with core modules locked on", async () => {
    await control.query("INSERT INTO platform_module_settings (module_key, enabled) VALUES ('platform.appearance', false)");
    const modules = await listPlatformModules(getControlDb());
    expect(modules.map((module) => module.key)).toStrictEqual([
      "platform.tenants",
      "platform.tenant_registrations",
      "platform.tenant_modules",
      "platform.appearance",
      "platform.roles",
      "platform.users",
      "platform.modules",
    ]);
    expect(modules.find((module) => module.key === "platform.appearance")).toMatchObject({ enabled: false, core: false });
    expect(modules.filter((module) => module.core).every((module) => module.enabled)).toBe(true);
    expect(modules[0]?.privileges.map((privilege) => privilege.key)).toContain("platform.tenants.view");
  });
});

describe("tenant modules", () => {
  it("switching tenant.registrations off for tenant A removes it from A's Master Tenant but not from tenant B", async () => {
    const ownerId = await signedInOwner();
    const admin   = await masterTenantUser();
    const accessFor = async (tenantId: string) =>
      resolveWorkspaceAccess(admin, "tenant", await loadDisabledTenantModules(getControlDb(), tenantId));

    // Before: the Master Tenant holds the registrations privileges.
    expect((await accessFor(tenant.id)).can("tenant.registrations.view")).toBe(true);

    // Off for tenant A only.
    const off = await setTenantModuleAction(tenant.id, "tenant.registrations", false);
    expect(off).toMatchObject({ ok: true, changed: true, module: { key: "tenant.registrations", domain: "tenant", enabled: false } });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/platform/tenants/${tenant.id}`);

    const a = await accessFor(tenant.id);
    expect(a.can("tenant.registrations.view")).toBe(false);
    expect(a.can("tenant.registrations.review")).toBe(false);
    // Core modules stay.
    expect(a.can("tenant.roles.view")).toBe(true);
    // Tenant B's switches are untouched.
    expect(await loadDisabledTenantModules(getControlDb(), tenantB)).toStrictEqual([]);
    expect((await accessFor(tenantB)).can("tenant.registrations.view")).toBe(true);

    // Listed per tenant and per panel.
    const groupsA = await listTenantModules(getControlDb(), tenant.id);
    expect(groupsA.tenant.find((module) => module.key === "tenant.registrations")?.enabled).toBe(false);
    expect(groupsA.customer.map((module) => module.key)).toStrictEqual(["customer.roles", "customer.sub_customers"]);
    const groupsB = await listTenantModules(getControlDb(), tenantB);
    expect(groupsB.tenant.find((module) => module.key === "tenant.registrations")?.enabled).toBe(true);

    // On again: restored on the next read.
    expect(await setTenantModuleAction(tenant.id, "tenant.registrations", true)).toMatchObject({ ok: true, changed: true });
    expect((await accessFor(tenant.id)).can("tenant.registrations.view")).toBe(true);

    // Audited with the tenant.
    expect(await auditRows(ownerId, "tenant_module.disabled")).toStrictEqual([
      {
        target_type: "module",
        target_id: "tenant.registrations",
        tenant_id: tenant.id,
        metadata: { moduleKey: "tenant.registrations" },
        ip_address: CLIENT_IP,
      },
    ]);
    expect(await auditRows(ownerId, "tenant_module.enabled")).toHaveLength(1);
  });

  it("a role with only platform.tenant_modules.manage can switch tenant modules but not platform modules", async () => {
    const ownerId = await signedInOwner(await platformRole(["platform.tenants.view", "platform.tenant_modules.manage"]));
    expect(await setTenantModuleAction(tenant.id, "tenant.appearance", false)).toMatchObject({ ok: true, changed: true });
    const stored = await control.query(
      "SELECT enabled, updated_by_id FROM tenant_module_settings WHERE tenant_id = $1 AND module_key = 'tenant.appearance'",
      [tenant.id],
    );
    expect(stored.rows).toStrictEqual([{ enabled: false, updated_by_id: ownerId }]);
    expect(await setPlatformModuleAction("platform.appearance", false)).toMatchObject({ ok: false, reason: "forbidden" });
  });
});

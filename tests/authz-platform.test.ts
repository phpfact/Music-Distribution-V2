/**
 * Platform authorization against the real migrated control plane
 * (.vibe/memory/role-privilege-management.md): effective privileges of
 * platform owners, immediate revocation, module switches, the request guards
 * (authorizePlatformAction) and the database constraints of the rbac migration.
 */
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/control/client";
import { getAppearanceState } from "@/lib/appearance/service";
import { permissionKeysOfDomain } from "@/lib/authz/catalog";
import { loadPlatformAccess } from "@/lib/authz/platform-access";
import { FORBIDDEN_MESSAGE, NO_ACTIVE_ROLE_MESSAGE } from "@/lib/authz/resolver";
import { getControlDb } from "@/lib/db/control";
import { createSession } from "@/lib/platform-auth/session";
import { migrationDatabaseUrl } from "../prisma/connection";
import { closeAppDatabase } from "./support/app-connections";
import { captureConsole } from "./support/console";
import { clearPlatformTables, connectToTestDatabase, insertOwner, insertPlatformRole, masterPlatformRoleId } from "./support/postgres";

// The request-bound pieces: the session cookie and the redirect of Next.js.
const mocks = vi.hoisted(() => ({
  token: undefined as string | undefined,
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (mocks.token ? { value: mocks.token } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
import { authorizePlatformAction, getPlatformAccess } from "@/lib/authz/platform";

const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo";
const RESTRICT_VIOLATION = "23001";
const NOT_NULL_VIOLATION = "23502";
const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

let db: Client;
// A second, independent Prisma client (its own pool): changes made through it
// must be visible to the application's client on the very next read.
let other: PrismaClient;

beforeAll(async () => {
  db = await connectToTestDatabase();
  const url = migrationDatabaseUrl(process.env.POSTGRES_DB);
  if (!url) throw new Error("no database URL");
  other = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 2 }) });
});

beforeEach(async () => {
  await clearPlatformTables(db);
  mocks.token = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await clearPlatformTables(db);
  await other.$disconnect();
  await db.end();
  await closeAppDatabase();
});

/** A unique username. */
function username(): string {
  return `vt-authz-${randomBytes(4).toString("hex")}`;
}

/** A unique custom role name. */
function roleName(): string {
  return `VT role ${randomBytes(4).toString("hex")}`;
}

/** Signs an owner in: the mocked cookie then carries a real session token. */
async function signIn(ownerId: string): Promise<void> {
  const token = await createSession(ownerId, HASH);
  if (!token) throw new Error("no session");
  mocks.token = token;
}

describe("effective platform privileges", () => {
  it("Master Platform holds every platform privilege", async () => {
    const ownerId = await insertOwner(db, { username: username(), passwordHash: HASH });
    const access  = await loadPlatformAccess(getControlDb(), ownerId);
    expect(access).toMatchObject({ ownerId, roleState: "active", isMaster: true, isPrimary: false });
    expect(access.permissions).toStrictEqual(permissionKeysOfDomain("platform"));
  });

  it("a custom role holds exactly its stored privileges", async () => {
    const roleId  = await insertPlatformRole(db, { name: roleName(), permissionKeys: ["platform.tenants.view", "platform.users.view"] });
    const ownerId = await insertOwner(db, { username: username(), passwordHash: HASH, roleId });
    const access  = await loadPlatformAccess(getControlDb(), ownerId);
    expect(access).toMatchObject({ roleId, roleState: "active", isMaster: false });
    expect(access.permissions).toStrictEqual(["platform.tenants.view", "platform.users.view"]);
  });

  it("a disabled role grants nothing, and an unknown or malformed owner id grants nothing", async () => {
    const roleId  = await insertPlatformRole(db, { name: roleName(), permissionKeys: ["platform.tenants.view"], status: "disabled" });
    const ownerId = await insertOwner(db, { username: username(), passwordHash: HASH, roleId });
    expect(await loadPlatformAccess(getControlDb(), ownerId)).toMatchObject({ roleState: "disabled", permissions: [] });
    expect(await loadPlatformAccess(getControlDb(), "019ba263-00e2-7b41-9fc9-2a4b47b5e999")).toMatchObject({ roleState: "missing", permissions: [] });
    expect(await loadPlatformAccess(getControlDb(), "' OR 1=1 --")).toMatchObject({ roleState: "missing", permissions: [] });
  });

  it("applies the platform module switches to every role, master included, but never to core modules", async () => {
    const ownerId = await insertOwner(db, { username: username(), passwordHash: HASH });
    await db.query(
      `INSERT INTO platform_module_settings (module_key, enabled)
       VALUES ('platform.tenants', false), ('platform.appearance', false), ('platform.roles', false), ('platform.users', true)`,
    );
    const access = await loadPlatformAccess(getControlDb(), ownerId);
    expect(access.isMaster).toBe(true);
    expect(access.can("platform.tenants.view")).toBe(false);
    expect(access.can("platform.appearance.manage_global")).toBe(false);
    // Core module: the setting is ignored.
    expect(access.can("platform.roles.edit")).toBe(true);
    expect(access.can("platform.tenant_registrations.view")).toBe(true);
    // The appearance service reads the same privilege.
    expect(await getAppearanceState(ownerId)).toMatchObject({ canManageGlobal: false });
  });

  it("makes revocation, role changes and role disabling visible on the next read through another client", async () => {
    const roleId  = await insertPlatformRole(db, { name: roleName(), permissionKeys: ["platform.tenants.view", "platform.appearance.manage_global"] });
    const ownerId = await insertOwner(db, { username: username(), passwordHash: HASH, roleId });
    const app     = getControlDb();
    expect((await loadPlatformAccess(app, ownerId)).can("platform.tenants.view")).toBe(true);
    expect(await getAppearanceState(ownerId)).toMatchObject({ canManageGlobal: true });

    // Revoked through the second, independent client.
    await other.platformRolePermission.delete({ where: { roleId_permissionKey: { roleId, permissionKey: "platform.tenants.view" } } });
    expect((await loadPlatformAccess(app, ownerId)).can("platform.tenants.view")).toBe(false);

    // Disabled through the second client.
    await other.platformRole.update({ where: { id: roleId }, data: { status: "disabled" } });
    expect(await loadPlatformAccess(app, ownerId)).toMatchObject({ roleState: "disabled", permissions: [] });
    expect(await getAppearanceState(ownerId)).toMatchObject({ canManageGlobal: false });

    // Reassigned to the master role through the second client.
    await other.platformOwner.update({ where: { id: ownerId }, data: { roleId: await masterPlatformRoleId(db) } });
    expect((await loadPlatformAccess(app, ownerId)).isMaster).toBe(true);
  });
});

describe("request guards", () => {
  it("getPlatformAccess returns null without a session, and the session with access otherwise", async () => {
    expect(await getPlatformAccess()).toBeNull();
    const ownerId = await insertOwner(db, { username: username(), passwordHash: HASH });
    await signIn(ownerId);
    const context = await getPlatformAccess();
    expect(context?.session.owner.id).toBe(ownerId);
    expect(context?.access.isMaster).toBe(true);
  });

  it("authorizePlatformAction allows a granted privilege", async () => {
    const roleId  = await insertPlatformRole(db, { name: roleName(), permissionKeys: ["platform.tenants.view"] });
    const ownerId = await insertOwner(db, { username: username(), passwordHash: HASH, roleId });
    await signIn(ownerId);
    const result = await authorizePlatformAction("platform.tenants.view");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.owner.id).toBe(ownerId);
  });

  it("authorizePlatformAction refuses a missing privilege with a friendly message and audits it", async () => {
    const output  = captureConsole();
    const roleId  = await insertPlatformRole(db, { name: roleName(), permissionKeys: ["platform.tenants.view"] });
    const ownerId = await insertOwner(db, { username: username(), passwordHash: HASH, roleId });
    await signIn(ownerId);

    expect(await authorizePlatformAction("platform.roles.create", { ipAddress: "203.0.113.9" })).toStrictEqual({
      ok: false,
      error: FORBIDDEN_MESSAGE,
    });
    const audit = await db.query(
      `SELECT actor_type::text AS actor_type, actor_id, tenant_id, target_type, target_id, metadata, host(ip_address) AS ip
       FROM audit_events WHERE action = 'authz.denied' AND actor_id = $1`,
      [ownerId],
    );
    expect(audit.rows).toStrictEqual([
      {
        actor_type: "super_admin",
        actor_id: ownerId,
        tenant_id: null,
        target_type: "permission",
        target_id: "platform.roles.create",
        metadata: { permission: "platform.roles.create", roleState: "active" },
        ip: "203.0.113.9",
      },
    ]);
    expect(output.text()).toContain("[authz] denied platform.roles.create");
    expect(output.text()).not.toContain(mocks.token ?? "never");
  });

  it("authorizePlatformAction explains a disabled role and redirects without a session", async () => {
    const roleId  = await insertPlatformRole(db, { name: roleName(), permissionKeys: ["platform.tenants.view"], status: "disabled" });
    const ownerId = await insertOwner(db, { username: username(), passwordHash: HASH, roleId });
    await signIn(ownerId);
    expect(await authorizePlatformAction("platform.tenants.view")).toStrictEqual({ ok: false, error: NO_ACTIVE_ROLE_MESSAGE });

    mocks.token = undefined;
    await expect(authorizePlatformAction("platform.tenants.view")).rejects.toThrow("NEXT_REDIRECT /platform/login");
  });
});

describe("control-plane constraints", () => {
  it("requires a role for every owner and refuses to delete a role in use", async () => {
    await expect(
      db.query("INSERT INTO platform_owners (id, username, password_hash) VALUES (gen_random_uuid(), $1, $2)", [username(), HASH]),
    ).rejects.toMatchObject({ code: NOT_NULL_VIOLATION });

    const roleId = await insertPlatformRole(db, { name: roleName(), permissionKeys: ["platform.tenants.view"] });
    await insertOwner(db, { username: username(), passwordHash: HASH, roleId });
    // ON DELETE RESTRICT reports a restrict violation.
    await expect(db.query("DELETE FROM platform_roles WHERE id = $1", [roleId])).rejects.toMatchObject({ code: RESTRICT_VIOLATION });
  });

  it("never deletes the master role or changes a system key, even when nobody holds it", async () => {
    // No owner exists here (cleared before every test): only the trigger protects it.
    await expect(db.query("DELETE FROM platform_roles WHERE system_key = 'master_platform'")).rejects.toMatchObject({
      code: RESTRICT_VIOLATION,
    });
    await expect(db.query("UPDATE platform_roles SET system_key = NULL WHERE system_key = 'master_platform'")).rejects.toMatchObject({
      code: CHECK_VIOLATION,
      constraint: "platform_roles_system_key_immutable",
    });
    expect((await db.query("SELECT 1 FROM platform_roles WHERE system_key = 'master_platform'")).rowCount).toBe(1);
  });

  it("allows one primary owner at most", async () => {
    const first  = await insertOwner(db, { username: username(), passwordHash: HASH });
    const second = await insertOwner(db, { username: username(), passwordHash: HASH });
    await db.query("UPDATE platform_owners SET is_primary = true WHERE id = $1", [first]);
    await expect(db.query("UPDATE platform_owners SET is_primary = true WHERE id = $1", [second])).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
    });
  });

  it("protects the master role and keeps role names unique case-insensitively", async () => {
    await expect(db.query("UPDATE platform_roles SET status = 'disabled' WHERE system_key = 'master_platform'")).rejects.toMatchObject({
      code: CHECK_VIOLATION,
      constraint: "platform_roles_system_active_check",
    });
    await expect(
      db.query("INSERT INTO platform_roles (id, name, system_key) VALUES (gen_random_uuid(), 'VT x', 'master_tenant')"),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    await expect(
      db.query("INSERT INTO platform_roles (id, name, system_key) VALUES (gen_random_uuid(), 'VT y', 'master_platform')"),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    await insertPlatformRole(db, { name: "VT Unique Name", permissionKeys: [] });
    await expect(insertPlatformRole(db, { name: "vt unique name", permissionKeys: [] })).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
    });
  });

  it("only stores catalog privileges, and a stored privilege cannot vanish from the catalog", async () => {
    const roleId = await insertPlatformRole(db, { name: roleName(), permissionKeys: ["platform.tenants.view"] });
    await expect(
      db.query("INSERT INTO platform_role_permissions (role_id, permission_key) VALUES ($1, 'platform.tenants.destroy')", [roleId]),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
    await expect(db.query("DELETE FROM platform_permissions WHERE key = 'platform.tenants.view'")).rejects.toMatchObject({
      code: RESTRICT_VIOLATION,
    });
    await expect(
      db.query("INSERT INTO platform_module_settings (module_key, enabled) VALUES ('tenant.registrations', false)"),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  it("keeps audit events append-only: UPDATE, DELETE and TRUNCATE are refused", async () => {
    await db.query(
      "INSERT INTO audit_events (id, actor_type, action) VALUES (gen_random_uuid(), 'system', 'tenant.created')",
    );
    await expect(db.query("UPDATE audit_events SET action = 'tampered'")).rejects.toMatchObject({ code: RESTRICT_VIOLATION });
    await expect(db.query("DELETE FROM audit_events")).rejects.toMatchObject({ code: RESTRICT_VIOLATION });
    await expect(db.query("TRUNCATE audit_events")).rejects.toMatchObject({ code: RESTRICT_VIOLATION });
    const kept = await db.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'tampered'");
    expect(kept.rows).toStrictEqual([{ n: 0 }]);
  });
});

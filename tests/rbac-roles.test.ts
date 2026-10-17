/**
 * Role management services against the REAL databases
 * (src/lib/authz/role-service.ts, .vibe/memory/role-privilege-management.md):
 * the platform domain on the migrated control plane, the tenant and customer
 * domains on two real provisioned tenants (isolation between them), every
 * delegation-ceiling rule, atomic delete-and-reassign and the audit trail.
 */
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { permissionKeysOfDomain } from "@/lib/authz/catalog";
import { loadPlatformAccess } from "@/lib/authz/platform-access";
import {
  createRole,
  deleteRole,
  getRoleDetails,
  getRoleEditorModel,
  getRoleSummary,
  listAssignableRoles,
  listRoleCountRecords,
  listRoles,
  listRoleUsers,
  setRoleStatus,
  updateRole,
} from "@/lib/authz/role-service";
import { getControlDb } from "@/lib/db/control";
import { closeAppDatabase } from "./support/app-connections";
import { clearPlatformTables, clearTenantTables, connectToTestDatabase, insertOwner, insertPlatformRole, masterPlatformRoleId } from "./support/postgres";
import {
  approvedCustomer,
  assignRole,
  auditRows,
  closeRbacTenant,
  customerActorOf,
  insertCustomer,
  insertRole,
  insertUser,
  one,
  openRbacTenant,
  platformActorOf,
  suffix,
  tenantActorOf,
  workspaceRoleKeys,
  waitForLockWaiter,
  type RbacTenant,
} from "./support/rbac";
import { TenantResources } from "./support/tenant-resources";

// Provisioning real tenant databases takes a while.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo";

let control: Client;
let resources: TenantResources;
let tenantA: RbacTenant;
let tenantB: RbacTenant;

// Platform fixtures.
let masterRoleId: string;
let ownerM: string; // primary Master Platform holder
let ownerL: string; // custom "limited" role holder
let limitedRoleId: string;
let highRoleId: string;

/** A unique role name. */
function roleName(prefix = "VT Role"): string {
  return `${prefix} ${suffix()}`;
}

/** The sorted privilege keys of a platform role. */
async function platformRoleKeys(roleId: string): Promise<string[]> {
  const result = await control.query<{ key: string }>(
    "SELECT permission_key AS key FROM platform_role_permissions WHERE role_id = $1 ORDER BY permission_key",
    [roleId],
  );
  return result.rows.map((row) => row.key);
}

/** The role input of a create/update call. */
function input(name: string, permissions: unknown, status = "active", description = "") {
  return { name, description, status, permissions };
}

beforeAll(async () => {
  control = await connectToTestDatabase();
  await clearPlatformTables(control);
  await clearTenantTables(control);
  resources = await TenantResources.open(control);

  // Platform: a primary master, a limited role manager and a role above them.
  masterRoleId  = await masterPlatformRoleId(control);
  ownerM        = await insertOwner(control, { username: `vt-m-${suffix()}`, passwordHash: HASH });
  await control.query("UPDATE platform_owners SET is_primary = true WHERE id = $1", [ownerM]);
  limitedRoleId = await insertPlatformRole(control, {
    name: roleName("VT Limited"),
    permissionKeys: [
      "platform.roles.view", "platform.roles.create", "platform.roles.edit", "platform.roles.delete",
      "platform.users.view", "platform.users.create", "platform.users.edit", "platform.users.suspend",
      "platform.tenants.view",
    ],
  });
  ownerL     = await insertOwner(control, { username: `vt-l-${suffix()}`, passwordHash: HASH, roleId: limitedRoleId });
  highRoleId = await insertPlatformRole(control, { name: roleName("VT High"), permissionKeys: ["platform.tenants.view", "platform.tenants.create"] });

  // Two real tenants (their databases are separate).
  tenantA = await openRbacTenant("rbacra", randomUUID());
  tenantB = await openRbacTenant("rbacrb", randomUUID());
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

describe("platform roles: privilege requests", () => {
  it("refuses tenant and customer keys and audits the escalation attempt", async () => {
    const actor = await platformActorOf(ownerM);
    for (const key of ["tenant.roles.view", "customer.roles.view"]) {
      const result = await createRole(actor, input(roleName(), ["platform.roles.view", key]));
      expect(result).toMatchObject({ ok: false, reason: "validation", fieldErrors: { permissions: expect.stringContaining("another panel") } });
    }
    const audits = await auditRows(control, "authz.escalation_blocked", ownerM);
    expect(audits.map((row) => row.metadata?.attempt)).toContain("privileges_other_domain");
    expect(audits.some((row) => (row.metadata?.keys as string[] | undefined)?.includes("tenant.roles.view"))).toBe(true);
  });

  it("refuses keys outside the actor's effective set and unknown keys", async () => {
    const actor = await platformActorOf(ownerL);
    expect(await createRole(actor, input(roleName(), ["platform.tenants.view", "platform.tenants.create"]))).toMatchObject({
      ok: false,
      fieldErrors: { permissions: "You can only grant privileges that you have yourself." },
    });
    expect(await createRole(actor, input(roleName(), ["platform.ghost.view"]))).toMatchObject({ ok: false, fieldErrors: { permissions: expect.any(String) } });
    expect(await createRole(actor, input(roleName(), []))).toMatchObject({ ok: false, fieldErrors: { permissions: "Select at least one privilege." } });

    // Inside the ceiling it works and stores exactly the keys.
    const created = await createRole(actor, input(roleName(), ["platform.tenants.view", "platform.users.view"]));
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;
    expect(await platformRoleKeys(created.roleId)).toStrictEqual(["platform.tenants.view", "platform.users.view"]);
    const audit = await auditRows(control, "role.created", ownerL);
    expect(audit.at(-1)).toMatchObject({ target_id: created.roleId, metadata: { added: ["platform.tenants.view", "platform.users.view"] } });
  });

  it("refuses disabled-module keys and preserves (never adds) existing ones on edit", async () => {
    const master   = await platformActorOf(ownerM);
    const withKeys = await createRole(master, input(roleName("VT Keeps"), ["platform.tenants.view", "platform.roles.view"]));
    const without  = await createRole(master, input(roleName("VT Lacks"), ["platform.roles.view"]));
    if (!withKeys.ok || !without.ok) throw new Error("setup failed");

    await control.query("INSERT INTO platform_module_settings (module_key, enabled) VALUES ('platform.tenants', false)");
    try {
      const actor = await platformActorOf(ownerM);
      expect(await createRole(actor, input(roleName(), ["platform.tenants.view"]))).toMatchObject({
        ok: false,
        fieldErrors: { permissions: expect.stringContaining("disabled") },
      });

      // Edit: the disabled module's key stays; the other role does not receive it.
      const edited = await updateRole(actor, withKeys.roleId, input(roleName("VT Keeps"), ["platform.roles.view", "platform.roles.create"]));
      expect(edited).toMatchObject({ ok: true });
      expect(await platformRoleKeys(withKeys.roleId)).toStrictEqual(["platform.roles.create", "platform.roles.view", "platform.tenants.view"]);
      expect(await updateRole(actor, without.roleId, input(roleName("VT Lacks"), ["platform.roles.view"]))).toMatchObject({ ok: true });
      expect(await platformRoleKeys(without.roleId)).toStrictEqual(["platform.roles.view"]);

      // The editor shows the preserved key aside and locks the module's privileges.
      const editor = await getRoleEditorModel(actor, withKeys.roleId);
      expect(editor).toMatchObject({ ok: true, data: { preservedKeys: ["platform.tenants.view"] } });
      if (editor.ok) {
        const tenants = editor.data.modules.find((module) => module.key === "platform.tenants");
        expect(tenants?.disabled).toBe(true);
        expect(tenants?.privileges.every((privilege) => privilege.lockedReason === "module_disabled")).toBe(true);
        expect(editor.data.initial.permissionKeys).toStrictEqual(["platform.roles.view", "platform.roles.create"]);
      }
    } finally {
      await control.query("DELETE FROM platform_module_settings");
    }
  });
});

describe("platform roles: what may be managed", () => {
  it("never the own role, a master role or a role above the ceiling", async () => {
    const limited = await platformActorOf(ownerL);
    const own = await updateRole(limited, limitedRoleId, input(roleName(), ["platform.roles.view"]));
    expect(own).toMatchObject({ ok: false, reason: "forbidden", error: "You cannot change the role you hold." });
    expect(await setRoleStatus(limited, limitedRoleId, "disabled")).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await deleteRole(limited, limitedRoleId)).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await updateRole(limited, highRoleId, input(roleName(), ["platform.tenants.view"]))).toMatchObject({
      ok: false,
      error: expect.stringContaining("beyond your own"),
    });

    const master = await platformActorOf(ownerM);
    expect(await updateRole(master, masterRoleId, input("Master Platform Copy", ["platform.roles.view"]))).toMatchObject({
      ok: false,
      error: "System roles cannot be changed.",
    });
    expect(await setRoleStatus(master, masterRoleId, "disabled")).toMatchObject({ ok: false, error: "System roles cannot be changed." });
    expect(await deleteRole(master, masterRoleId)).toMatchObject({ ok: false, error: "System roles cannot be changed." });

    // Nothing changed, and each refusal was audited.
    expect(await platformRoleKeys(highRoleId)).toStrictEqual(["platform.tenants.create", "platform.tenants.view"]);
    const attempts = (await auditRows(control, "authz.escalation_blocked", ownerL)).map((row) => row.metadata?.attempt);
    expect(attempts).toEqual(expect.arrayContaining(["own_role", "above_ceiling"]));

    // The list marks them as not manageable.
    const list = await listRoles(limited, { q: "", status: "all", page: 1 });
    if (!list.ok) throw new Error("list failed");
    const flags = Object.fromEntries(list.data.rows.map((row) => [row.id, row.manageable]));
    expect(flags[limitedRoleId]).toBe(false);
    expect(flags[highRoleId]).toBe(false);
    expect(flags[masterRoleId]).toBe(false);
    expect(list.data.rows[0]).toMatchObject({ id: masterRoleId, isMaster: true, privilegeCount: null });
  });

  it("rejects a copy of a master role's name (it would grant nothing) and duplicate names", async () => {
    const master = await platformActorOf(ownerM);
    expect(await createRole(master, input("master   PLATFORM", ["platform.roles.view"]))).toMatchObject({
      ok: false,
      fieldErrors: { name: expect.stringContaining("reserved") },
    });
    const named = await one(control, "SELECT count(*)::text AS id FROM platform_roles WHERE lower(name) = 'master platform'");
    expect(named).toBe("1");

    const name = roleName("VT Dupe");
    expect(await createRole(master, input(name, ["platform.roles.view"]))).toMatchObject({ ok: true });
    expect(await createRole(master, input(name.toUpperCase(), ["platform.roles.view"]))).toMatchObject({
      ok: false,
      reason: "conflict",
      fieldErrors: { name: expect.any(String) },
    });
  });

  it("disables and enables a role; holders lose and regain access on their next read", async () => {
    const master = await platformActorOf(ownerM);
    const roleId = await insertPlatformRole(control, { name: roleName("VT Toggle"), permissionKeys: ["platform.users.view"] });
    const holder = await insertOwner(control, { username: `vt-t-${suffix()}`, passwordHash: HASH, roleId });

    expect(await setRoleStatus(master, roleId, "disabled")).toMatchObject({ ok: true, affectedUserCount: 1 });
    expect(await loadPlatformAccess(getControlDb(), holder)).toMatchObject({ roleState: "disabled", permissions: [] });
    expect(await setRoleStatus(master, roleId, "disabled")).toMatchObject({ ok: false, reason: "conflict" });
    expect(await setRoleStatus(master, roleId, "enabled")).toMatchObject({ ok: false, reason: "validation" });
    expect(await setRoleStatus(master, roleId, "active")).toMatchObject({ ok: true });
    expect((await loadPlatformAccess(getControlDb(), holder)).permissions).toStrictEqual(["platform.users.view"]);
  });
});

describe("platform roles: delete with replacement", () => {
  it("requires exactly one assignable replacement, then reassigns and deletes together", async () => {
    const master      = await platformActorOf(ownerM);
    const doomed      = await insertPlatformRole(control, { name: roleName("VT Doomed"), permissionKeys: ["platform.roles.view", "platform.users.view"] });
    const replacement = await insertPlatformRole(control, { name: roleName("VT Heir"), permissionKeys: ["platform.tenants.view"] });
    const holder1     = await insertOwner(control, { username: `vt-h1-${suffix()}`, passwordHash: HASH, roleId: doomed });
    const holder2     = await insertOwner(control, { username: `vt-h2-${suffix()}`, passwordHash: HASH, roleId: doomed });
    expect((await loadPlatformAccess(getControlDb(), holder1)).permissions).toStrictEqual(["platform.roles.view", "platform.users.view"]);

    // Missing, repeated, same and unknown replacements are refused.
    expect(await deleteRole(master, doomed)).toMatchObject({ ok: false, fieldErrors: { replacementRoleId: expect.any(String) } });
    expect(await deleteRole(master, doomed, { replacementRoleId: [replacement, doomed] })).toMatchObject({
      ok: false,
      fieldErrors: { replacementRoleId: "Choose exactly one role." },
    });
    expect(await deleteRole(master, doomed, { replacementRoleId: [doomed] })).toMatchObject({ ok: false, fieldErrors: { replacementRoleId: expect.any(String) } });
    expect(await deleteRole(master, doomed, { replacementRoleId: [randomUUID()] })).toMatchObject({ ok: false, fieldErrors: { replacementRoleId: expect.any(String) } });

    // With a valid replacement: holders move, the role is gone, old privileges are gone on the next read.
    const result = await deleteRole(master, doomed, { replacementRoleId: [replacement] });
    expect(result).toMatchObject({ ok: true, affectedUserCount: 2 });
    expect(await one(control, "SELECT count(*)::text AS id FROM platform_roles WHERE id = $1", [doomed])).toBe("0");
    expect((await loadPlatformAccess(getControlDb(), holder1)).permissions).toStrictEqual(["platform.tenants.view"]);
    expect((await loadPlatformAccess(getControlDb(), holder2)).roleId).toBe(replacement);
    const changed = await auditRows(control, "user.role_changed", ownerM);
    expect(changed.at(-1)?.metadata).toMatchObject({ fromRoleId: doomed, toRoleId: replacement, userIds: [holder1, holder2].sort() });
  });

  it("is atomic: a failure after the reassignment leaves everything unchanged", async () => {
    const master      = await platformActorOf(ownerM);
    const failName    = roleName("VT Fails");
    const failing     = await insertPlatformRole(control, { name: failName, permissionKeys: ["platform.roles.view"] });
    const replacement = await insertPlatformRole(control, { name: roleName("VT Spare"), permissionKeys: ["platform.users.view"] });
    const holder      = await insertOwner(control, { username: `vt-f-${suffix()}`, passwordHash: HASH, roleId: failing });

    // A trigger makes the final DELETE fail (after the holders were already moved).
    await control.query(`
      CREATE OR REPLACE FUNCTION vt_fail_role_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.name = '${failName}' THEN RAISE EXCEPTION 'simulated failure'; END IF;
        RETURN OLD;
      END $$`);
    await control.query("CREATE TRIGGER vt_fail_role_delete BEFORE DELETE ON platform_roles FOR EACH ROW EXECUTE FUNCTION vt_fail_role_delete()");
    try {
      const result = await deleteRole(master, failing, { replacementRoleId: [replacement] });
      expect(result).toStrictEqual({ ok: false, reason: "unavailable", error: "The change could not be saved. Please try again." });
    } finally {
      await control.query("DROP TRIGGER IF EXISTS vt_fail_role_delete ON platform_roles");
      await control.query("DROP FUNCTION IF EXISTS vt_fail_role_delete()");
    }
    expect(await one(control, "SELECT role_id::text AS id FROM platform_owners WHERE id = $1", [holder])).toBe(failing);
    expect(await platformRoleKeys(failing)).toStrictEqual(["platform.roles.view"]);
  });

  it("a non-master actor cannot hand the master role over as the replacement", async () => {
    const limited = await platformActorOf(ownerL);
    const roleId  = await insertPlatformRole(control, { name: roleName("VT Small"), permissionKeys: ["platform.users.view"] });
    const holder  = await insertOwner(control, { username: `vt-s-${suffix()}`, passwordHash: HASH, roleId });
    const result  = await deleteRole(limited, roleId, { replacementRoleId: [masterRoleId] });
    expect(result).toMatchObject({ ok: false, fieldErrors: { replacementRoleId: expect.stringContaining("master role") } });
    expect(await one(control, "SELECT role_id::text AS id FROM platform_owners WHERE id = $1", [holder])).toBe(roleId);
  });
});

describe("platform roles: the actor's own ceiling under concurrency", () => {
  it("a revocation committed while the actor's mutation waits is honoured (never a stale ceiling)", async () => {
    // The actor holds a role that may create roles; its snapshot still says so.
    const roleId = await insertPlatformRole(control, { name: roleName("VT Racer"), permissionKeys: ["platform.roles.view", "platform.roles.create"] });
    const racer  = await insertOwner(control, { username: `vt-race-${suffix()}`, passwordHash: HASH, roleId });
    const actor  = await platformActorOf(racer);
    expect(actor.permissions).toContain("platform.roles.create");

    // Another transaction revokes "create" from that role, holding the role row lock
    // (exactly like updateRole does) and not committed yet.
    const revoker = await connectToTestDatabase();
    const name    = roleName("VT Raced");
    try {
      await revoker.query("BEGIN");
      await revoker.query("SELECT id FROM platform_roles WHERE id = $1 FOR UPDATE", [roleId]);
      await revoker.query("DELETE FROM platform_role_permissions WHERE role_id = $1 AND permission_key = 'platform.roles.create'", [roleId]);

      // The actor's mutation starts and must wait on its own role's share lock.
      const pending = createRole(actor, input(name, ["platform.roles.view"]));
      await waitForLockWaiter(control);
      await revoker.query("COMMIT");

      // It then re-reads the ceiling after the revocation and refuses.
      expect(await pending).toMatchObject({ ok: false, reason: "forbidden" });
    } finally {
      await revoker.query("ROLLBACK").catch(() => undefined);
      await revoker.end();
    }
    expect(await one(control, "SELECT count(*)::text AS id FROM platform_roles WHERE name = $1", [name])).toBe("0");
  });
});

describe("platform roles: queries", () => {
  it("lists, counts and explains every figure with the exact records", async () => {
    const master  = await platformActorOf(ownerM);
    const summary = await getRoleSummary(master);
    if (!summary.ok) throw new Error("summary failed");
    expect(summary.data.total).toBe(Number(await one(control, "SELECT count(*)::text AS id FROM platform_roles")));
    expect(summary.data.disabled).toBe(Number(await one(control, "SELECT count(*)::text AS id FROM platform_roles WHERE status = 'disabled'")));
    expect(summary.data.usersAssigned).toBe(Number(await one(control, "SELECT count(*)::text AS id FROM platform_owners")));
    expect(summary.data.active + summary.data.disabled).toBe(summary.data.total);

    const total = await listRoleCountRecords(master, "total", 1);
    expect(total).toMatchObject({ ok: true, data: { kind: "roles", page: { total: summary.data.total } } });
    const users = await listRoleCountRecords(master, "users_assigned", 1);
    expect(users).toMatchObject({ ok: true, data: { kind: "users", page: { total: summary.data.usersAssigned } } });
    expect(await listRoleCountRecords(master, "everything", 1)).toMatchObject({ ok: false, reason: "validation" });

    // Search on the name, server side.
    const search = await listRoles(master, { q: "VT High", status: "all", page: 1 });
    expect(search).toMatchObject({ ok: true, data: { total: 1, rows: [{ id: highRoleId, privilegeCount: 2 }] } });

    // Details of the master role: every privilege, its holders, not manageable.
    const details = await getRoleDetails(master, masterRoleId);
    expect(details).toMatchObject({ ok: true, data: { role: { isMaster: true, privilegeCount: null }, manageable: false, manageableReason: "system_role" } });
    if (details.ok) {
      expect(details.data.modules.flatMap((module) => module.privileges.map((privilege) => privilege.key))).toStrictEqual(permissionKeysOfDomain("platform"));
      expect(details.data.assignedUsers.rows.map((row) => row.id)).toContain(ownerM);
    }
    expect(await getRoleDetails(master, randomUUID())).toMatchObject({ ok: false, reason: "not_found" });
    expect(await listRoleUsers(master, limitedRoleId, 1)).toMatchObject({ ok: true, data: { total: 1, rows: [{ id: ownerL }] } });
  });

  it("builds the editor and the pickers for THIS actor", async () => {
    const limited = await platformActorOf(ownerL);
    const editor  = await getRoleEditorModel(limited);
    if (!editor.ok) throw new Error("editor failed");
    const privileges = editor.data.modules.flatMap((module) => module.privileges);
    expect(privileges.find((privilege) => privilege.key === "platform.tenants.view")).toMatchObject({ assignable: true, lockedReason: null });
    expect(privileges.find((privilege) => privilege.key === "platform.tenants.create")).toMatchObject({ assignable: false, lockedReason: "outside_privileges" });
    expect(await getRoleEditorModel(limited, highRoleId)).toMatchObject({ ok: false, reason: "forbidden" });

    const pickers = await listAssignableRoles(limited);
    if (!pickers.ok) throw new Error("pickers failed");
    const ids = pickers.data.map((option) => option.id);
    expect(ids).not.toContain(masterRoleId);
    expect(ids).not.toContain(highRoleId);
    expect(ids).toContain(limitedRoleId);
    const masterPickers = await listAssignableRoles(await platformActorOf(ownerM));
    expect(masterPickers.ok && masterPickers.data[0]).toMatchObject({ id: masterRoleId, isMaster: true, privilegeCount: null });
  });

  it("refuses an actor without the view privilege", async () => {
    const roleId = await insertPlatformRole(control, { name: roleName("VT Viewless"), permissionKeys: ["platform.tenants.view"] });
    const owner  = await insertOwner(control, { username: `vt-v-${suffix()}`, passwordHash: HASH, roleId });
    const actor  = await platformActorOf(owner);
    expect(await listRoles(actor, { q: "", status: "all", page: 1 })).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await createRole(actor, input(roleName(), ["platform.tenants.view"]))).toMatchObject({ ok: false, reason: "forbidden" });
  });
});

// ---------------------------------------------------------------------------

describe("tenant roles", () => {
  it("a tenant actor cannot use platform or customer keys; a Sub-Tenant cannot reach tenant B", async () => {
    // A Sub-Tenant of A holding a role manager role.
    const admin   = await tenantActorOf(tenantA, tenantA.adminId);
    const manager = await createRole(admin, input(roleName("VT Manager"), ["tenant.roles.view", "tenant.roles.create", "tenant.roles.edit", "tenant.roles.delete", "tenant.users.view"]));
    if (!manager.ok) throw new Error("setup failed");
    const subTenant = await insertUser(tenantA.rt, { handle: "subt" });
    await assignRole(tenantA.rt, subTenant, manager.roleId);
    const actor = await tenantActorOf(tenantA, subTenant);

    for (const key of ["platform.tenants.view", "customer.roles.view"]) {
      expect(await createRole(actor, input(roleName(), ["tenant.users.view", key]))).toMatchObject({
        ok: false,
        fieldErrors: { permissions: expect.stringContaining("another panel") },
      });
    }
    const created = await createRole(actor, input(roleName("VT Viewer"), ["tenant.users.view"]));
    expect(created).toMatchObject({ ok: true });
    if (created.ok) expect(await workspaceRoleKeys(tenantA.rt, created.roleId)).toStrictEqual(["tenant.users.view"]);

    // Tenant B's role: invisible and untouchable from tenant A.
    const adminB = await tenantActorOf(tenantB, tenantB.adminId);
    const roleB  = await createRole(adminB, input(roleName("VT Role B"), ["tenant.users.view"]));
    if (!roleB.ok) throw new Error("setup failed");
    expect(await getRoleDetails(actor, roleB.roleId)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await updateRole(actor, roleB.roleId, input(roleName(), ["tenant.users.view"]))).toMatchObject({ ok: false, reason: "not_found" });
    expect(await setRoleStatus(actor, roleB.roleId, "disabled")).toMatchObject({ ok: false, reason: "not_found" });
    expect(await deleteRole(actor, roleB.roleId)).toMatchObject({ ok: false, reason: "not_found" });
    const list = await listRoles(actor, { q: "", status: "all", page: 1 });
    expect(list.ok && list.data.rows.some((row) => row.id === roleB.roleId)).toBe(false);
    expect(await one(tenantB.rt, "SELECT status::text AS id FROM roles WHERE id = $1", [roleB.roleId])).toBe("active");

    // The Master Tenant role is listed first and never manageable.
    expect(list.ok && list.data.rows[0]).toMatchObject({ id: tenantA.masterTenantId, isMaster: true, manageable: false });
  });
});

describe("customer roles", () => {
  it("stays inside the main customer: no tenant keys, no other main customer's roles, owner = main customer", async () => {
    const x = await approvedCustomer(tenantA, "Xavier Label");
    const y = await approvedCustomer(tenantA, "Yvonne Label");
    const actorX = await customerActorOf(tenantA, x.userId);
    const actorY = await customerActorOf(tenantA, y.userId);

    expect(await createRole(actorX, input(roleName(), ["tenant.roles.view"]))).toMatchObject({
      ok: false,
      fieldErrors: { permissions: expect.stringContaining("another panel") },
    });
    const roleX = await createRole(actorX, input(roleName("VT X Team"), ["customer.roles.view", "customer.roles.create", "customer.sub_customers.view"]));
    const roleY = await createRole(actorY, input(roleName("VT Y Team"), ["customer.sub_customers.view"]));
    if (!roleX.ok || !roleY.ok) throw new Error("setup failed");
    expect(await one(tenantA.rt, "SELECT owner_customer_id::text AS id FROM roles WHERE id = $1", [roleX.roleId])).toBe(x.customerId);

    // X never sees or touches Y's role.
    const list = await listRoles(actorX, { q: "", status: "all", page: 1 });
    if (!list.ok) throw new Error("list failed");
    expect(list.data.rows.map((row) => row.id)).toStrictEqual([tenantA.masterCustomerId, roleX.roleId]);
    expect(await getRoleDetails(actorX, roleY.roleId)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await updateRole(actorX, roleY.roleId, input(roleName(), ["customer.sub_customers.view"]))).toMatchObject({ ok: false, reason: "not_found" });
    expect(await deleteRole(actorX, roleY.roleId)).toMatchObject({ ok: false, reason: "not_found" });

    // Master Customer is held by both main customers, but each sees only its own tree.
    expect(list.data.rows[0]).toMatchObject({ isMaster: true, userCount: 1 });
    const holders = await listRoleUsers(actorX, tenantA.masterCustomerId, 1);
    expect(holders).toMatchObject({ ok: true, data: { total: 1, rows: [{ id: x.userId, isPrimary: true }] } });

    // A sub-customer of X with role rights creates roles owned by X (the main customer), never by itself.
    const subCustomer = await insertCustomer(tenantA.rt, "Xavier Sub", x.customerId);
    const subUser     = await insertUser(tenantA.rt, { handle: "xsub", customerId: subCustomer });
    await assignRole(tenantA.rt, subUser, roleX.roleId);
    const subActor = await customerActorOf(tenantA, subUser);
    const made     = await createRole(subActor, input(roleName("VT Sub Made"), ["customer.roles.view"]));
    expect(made).toMatchObject({ ok: true });
    if (made.ok) expect(await one(tenantA.rt, "SELECT owner_customer_id::text AS id FROM roles WHERE id = $1", [made.roleId])).toBe(x.customerId);
    // It cannot edit the role it holds, nor grant what it lacks.
    expect(await updateRole(subActor, roleX.roleId, input(roleName(), ["customer.roles.view"]))).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await createRole(subActor, input(roleName(), ["customer.roles.delete", "customer.roles.view"]))).toMatchObject({ ok: false });

    // A raw insert of a role owned by Y with a name X already uses is fine (names are unique per owner).
    await insertRole(tenantA.rt, { name: list.data.rows[1]?.name ?? "x", domain: "customer", owner: y.customerId, keys: ["customer.roles.view"] });
  });
});

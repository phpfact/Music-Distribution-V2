/**
 * The Server Actions of the platform Roles & Privileges and Sub-Platform
 * Owners pages, invoked the way Next.js invokes them
 * (.vibe/memory/role-privilege-management.md, "Technical Notes" → "RBAC pages
 * (all panels)"): each authorizes by its exact privilege (refusal + an
 * `authz.denied` row), creates a role with a redirect + `role.created`, refuses
 * a privilege above the actor's ceiling under Privileges (+
 * `authz.escalation_blocked`), creates a Sub-Platform Owner only with exactly
 * one valid platform role id, and never edits the own or the primary account.
 *
 * Real scratch control plane and one REAL provisioned tenant (for a genuine
 * tenant role id); only the request plumbing of Next.js (cookies, headers,
 * redirect, cache, after) is replaced.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { permissionKeysOfDomain } from "@/lib/authz/catalog";
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
import { auditRows, closeRbacTenant, letters, openRbacTenant, STRONG_PASSWORD, suffix, type RbacTenant } from "./support/rbac";
import { TenantResources } from "./support/tenant-resources";

// Provisioning a real tenant database takes a while.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

// ---------------------------------------------------------------------------
// The request plumbing of Next.js.

const mocks = vi.hoisted(() => ({
  /** Cookie name → value of the "current request". */
  cookies: new Map<string, string>(),
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
      "x-forwarded-for": "203.0.113.78",
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

// Imported after the mocks.
import {
  createRoleAction,
  deleteRoleAction,
  loadAssignedUserRecordsAction,
  loadRolePrivilegesAction,
  loadRoleRecordsAction,
  loadRoleUsersAction,
  setRoleStatusAction,
  updateRoleAction,
} from "@/app/platform/(console)/roles/actions";
import {
  createSubPlatformOwnerAction,
  loadSubPlatformOwnerRecordsAction,
  setSubPlatformOwnerStatusAction,
  updateSubPlatformOwnerAction,
} from "@/app/platform/(console)/users/actions";

const PLATFORM_COOKIE = "md_platform_session";
const HASH            = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo";

let control: Client;
let resources: TenantResources;
let tenant: RbacTenant | undefined;
let viewerRoleId = "";

beforeAll(async () => {
  control   = await connectToTestDatabase();
  await clearPlatformTables(control);
  await clearTenantTables(control);
  resources = await TenantResources.open(control);
  tenant    = await openRbacTenant("rbacpp", randomUUID());
  // A role every manager below may assign (its privileges ⊆ theirs).
  viewerRoleId = await insertPlatformRole(control, { name: `VT Viewer ${suffix()}`, permissionKeys: ["platform.tenants.view"] });
});

beforeEach(() => {
  mocks.cookies.clear();
  mocks.redirect.mockClear();
});

afterAll(async () => {
  await closeRbacTenant(tenant);
  await resources?.cleanup();
  await clearTenantTables(control);
  await clearPlatformTables(control);
  await resources?.close();
  await control.end();
  await closeAppDatabase();
});

// ---------------------------------------------------------------------------
// Helpers

/** A custom platform role with exactly these privileges. */
async function platformRole(keys: readonly string[]): Promise<string> {
  return insertPlatformRole(control, { name: `VT Pages ${suffix()}`, permissionKeys: keys });
}

/** A platform owner holding the given role (Master Platform when omitted), signed in for this "request". */
async function signedInOwner(roleId?: string): Promise<string> {
  const ownerId = await insertOwner(control, {
    username: `vt-pg-${suffix()}`,
    passwordHash: HASH,
    ...(roleId ? { roleId } : {}),
  });
  const token = randomBytes(32).toString("base64url");
  await insertSession(control, { ownerId, tokenHash: sha256Hex(token), lastUsedMinutesAgo: 5 });
  mocks.cookies.set(PLATFORM_COOKIE, token);
  return ownerId;
}

/** Runs a form action that redirects on success; returns the redirect target or the returned state. */
async function submit<State>(run: () => Promise<State>): Promise<{ redirectedTo: string } | { state: State }> {
  try {
    return { state: await run() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("NEXT_REDIRECT ")) return { redirectedTo: message.slice("NEXT_REDIRECT ".length) };
    throw error;
  }
}

/** The role editor's form. */
function roleForm(name: string, privileges: readonly string[]): FormData {
  const form = new FormData();
  form.set("name", name);
  form.set("description", "Created by the pages test");
  form.set("status", "active");
  for (const key of privileges) form.append("privileges", key);
  return form;
}

/** The Sub-Platform Owner create form with the given role entries. */
function ownerForm(username: string, roleIds: readonly string[]): FormData {
  const form = new FormData();
  form.set("fullName", `Vt Sub ${letters()}`);
  form.set("username", username);
  form.set("password", STRONG_PASSWORD);
  form.set("confirmPassword", STRONG_PASSWORD);
  for (const id of roleIds) form.append("roleId", id);
  return form;
}

/** How many authz.denied rows exist for this actor and privilege. */
async function denials(actorId: string, permission: string): Promise<number> {
  const result = await control.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM audit_events WHERE action = 'authz.denied' AND actor_id = $1 AND target_id = $2",
    [actorId, permission],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** The message a refusal carries, whatever the action's result shape is. */
function refusalMessage(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const record = result as Record<string, unknown>;
  for (const key of ["error", "formMessage"]) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Roles

describe("role actions", () => {
  it("createRoleAction creates the role, redirects to it with a notice and audits role.created", async () => {
    const ownerId = await signedInOwner(await platformRole(["platform.roles.view", "platform.roles.create", "platform.tenants.view"]));
    const name    = `VT Created ${letters()}`;

    const outcome = await submit(() => createRoleAction({ status: "idle" }, roleForm(name, ["platform.tenants.view"])));
    expect(outcome).toMatchObject({ redirectedTo: expect.stringMatching(/^\/platform\/roles\/[0-9a-f-]{36}\?notice=role-created$/) });

    const row = await control.query<{ id: string }>("SELECT id FROM platform_roles WHERE name = $1", [name]);
    expect(row.rows).toHaveLength(1);
    const keys = await control.query<{ permission_key: string }>("SELECT permission_key FROM platform_role_permissions WHERE role_id = $1", [row.rows[0]!.id]);
    expect(keys.rows.map((key) => key.permission_key)).toEqual(["platform.tenants.view"]);
    const audits = await auditRows(control, "role.created", ownerId);
    expect(audits.map((audit) => audit.target_id)).toEqual([row.rows[0]!.id]);
  });

  it("createRoleAction refuses a privilege above the actor's ceiling under Privileges and audits the attempt", async () => {
    const ownerId = await signedInOwner(await platformRole(["platform.roles.view", "platform.roles.create", "platform.tenants.view"]));
    const name    = `VT Escalate ${letters()}`;

    const outcome = await submit(() => createRoleAction({ status: "idle" }, roleForm(name, ["platform.tenants.view", "platform.tenants.create"])));
    expect(outcome).toMatchObject({ state: { status: "error", fieldErrors: { privileges: expect.any(String) } } });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect((await control.query("SELECT 1 FROM platform_roles WHERE name = $1", [name])).rowCount).toBe(0);
    expect(await auditRows(control, "authz.escalation_blocked", ownerId)).not.toHaveLength(0);
  });

  it("the role loaders return the records for a viewer", async () => {
    await signedInOwner(await platformRole(["platform.roles.view"]));
    expect(await loadRoleRecordsAction("all", 1)).toMatchObject({ ok: true, page: { total: expect.any(Number) } });
    expect(await loadAssignedUserRecordsAction(1)).toMatchObject({ ok: true });
    expect(await loadRolePrivilegesAction(viewerRoleId)).toMatchObject({
      ok: true,
      modules: [{ key: "platform.tenants", privileges: [{ key: "platform.tenants.view" }] }],
    });
    expect(await loadRoleUsersAction(viewerRoleId, 1)).toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Sub-Platform Owners

describe("Sub-Platform Owner actions", () => {
  const MANAGER_KEYS = ["platform.users.view", "platform.users.create", "platform.users.edit", "platform.users.suspend", "platform.tenants.view"];

  it("createSubPlatformOwnerAction refuses zero, two, a tenant role and a malformed role id; nothing is created", async () => {
    await signedInOwner(await platformRole(MANAGER_KEYS));
    const tenantRoleId = tenant!.masterTenantId;
    const cases: string[][] = [[], [viewerRoleId, viewerRoleId], [tenantRoleId], ["not-a-uuid"]];
    for (const roleIds of cases) {
      const username = `vtsub${suffix()}`;
      const outcome  = await submit(() => createSubPlatformOwnerAction({ status: "idle" }, ownerForm(username, roleIds)));
      expect(outcome).toMatchObject({ state: { status: "error", fieldErrors: { roleId: expect.any(String) } } });
      expect((await control.query("SELECT 1 FROM platform_owners WHERE username = $1", [username])).rowCount).toBe(0);
    }
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("createSubPlatformOwnerAction creates the account with exactly the chosen role and redirects with a notice", async () => {
    await signedInOwner(await platformRole(MANAGER_KEYS));
    const username = `vtsub${suffix()}`;
    const outcome  = await submit(() => createSubPlatformOwnerAction({ status: "idle" }, ownerForm(username, [viewerRoleId])));
    expect(outcome).toEqual({ redirectedTo: "/platform/users?notice=user-created" });
    const row = await control.query<{ role_id: string; is_primary: boolean }>("SELECT role_id, is_primary FROM platform_owners WHERE username = $1", [username]);
    expect(row.rows).toEqual([{ role_id: viewerRoleId, is_primary: false }]);
  });

  it("updateSubPlatformOwnerAction refuses the own account and the primary account", async () => {
    const ownerId = await signedInOwner(await platformRole(MANAGER_KEYS));

    // The own account.
    const self = new FormData();
    self.set("fullName", "Vt Myself");
    self.append("roleId", viewerRoleId);
    const own = await submit(() => updateSubPlatformOwnerAction(ownerId, { status: "idle" }, self));
    expect(own).toMatchObject({ state: { status: "error" } });
    expect(refusalMessage((own as { state: unknown }).state)).toMatch(/own account/i);

    // The primary account (lockout protection).
    const primaryId = await insertOwner(control, { username: `vt-pr-${suffix()}`, passwordHash: HASH });
    await control.query("UPDATE platform_owners SET is_primary = false WHERE is_primary");
    await control.query("UPDATE platform_owners SET is_primary = true WHERE id = $1", [primaryId]);
    const other = new FormData();
    other.set("fullName", "Vt Primary");
    other.append("roleId", viewerRoleId);
    const primary = await submit(() => updateSubPlatformOwnerAction(primaryId, { status: "idle" }, other));
    expect(primary).toMatchObject({ state: { status: "error" } });
    const after = await control.query<{ role_id: string }>("SELECT role_id FROM platform_owners WHERE id = $1", [primaryId]);
    expect(after.rows[0]?.role_id).not.toBe(viewerRoleId);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Every action without its privilege

type ActionCase = [name: string, permission: string, run: () => Promise<unknown>];

const missing = randomUUID();
const ACTIONS: ActionCase[] = [
  ["createRoleAction", "platform.roles.create", () => createRoleAction({ status: "idle" }, roleForm("VT Nope", ["platform.tenants.view"]))],
  ["updateRoleAction", "platform.roles.edit", () => updateRoleAction(missing, { status: "idle" }, roleForm("VT Nope", ["platform.tenants.view"]))],
  ["setRoleStatusAction", "platform.roles.edit", () => setRoleStatusAction(missing, "disabled")],
  ["deleteRoleAction", "platform.roles.delete", () => deleteRoleAction(missing, null)],
  ["loadRolePrivilegesAction", "platform.roles.view", () => loadRolePrivilegesAction(missing)],
  ["loadRoleUsersAction", "platform.roles.view", () => loadRoleUsersAction(missing, 1)],
  ["loadRoleRecordsAction", "platform.roles.view", () => loadRoleRecordsAction("all", 1)],
  ["loadAssignedUserRecordsAction", "platform.roles.view", () => loadAssignedUserRecordsAction(1)],
  ["createSubPlatformOwnerAction", "platform.users.create", () => createSubPlatformOwnerAction({ status: "idle" }, ownerForm("vtnope", [missing]))],
  ["updateSubPlatformOwnerAction", "platform.users.edit", () => updateSubPlatformOwnerAction(missing, { status: "idle" }, ownerForm("vtnope", [missing]))],
  ["setSubPlatformOwnerStatusAction", "platform.users.suspend", () => setSubPlatformOwnerStatusAction(missing, "suspend")],
  ["loadSubPlatformOwnerRecordsAction", "platform.users.view", () => loadSubPlatformOwnerRecordsAction("all", 1)],
];

describe("every action without its privilege", () => {
  it.each(ACTIONS)("%s refuses without %s and audits authz.denied", async (_name, permission, run) => {
    // Every platform privilege except the one this action needs (and the privileges that require it).
    const others  = permissionKeysOfDomain("platform").filter((key) => key !== permission);
    const ownerId = await signedInOwner(await platformRole(others));

    const outcome = await submit(run);
    expect(outcome).toHaveProperty("state");
    expect(refusalMessage((outcome as { state: unknown }).state)).toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(await denials(ownerId, permission)).toBe(1);
  });
});

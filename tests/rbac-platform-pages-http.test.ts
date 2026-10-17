/**
 * The platform Roles & Privileges and Sub-Platform Owners pages over plain
 * HTTP, against the RUNNING dev server (.vibe/memory/role-privilege-management.md,
 * "Technical Notes" → "RBAC pages (all panels)"): every page answers 200 with
 * the inline access-denied state without its privilege and renders with it (an
 * owner with a custom role and a Master Platform owner); unknown or malformed
 * ids answer a real HTTP 404 with the not-found state; the role editor
 * lists only the owner's assignable privileges as checkboxes and shows the
 * rest as "Not assignable"; system roles and the owner's own account cannot be
 * edited.
 *
 * The dev server reads the development database, so this suite adds
 * throwaway custom roles and owners (`e2e-rbacp-<random>`) with their sessions
 * there, and removes exactly those again.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectTo, insertOwner, insertPlatformRole, insertSession, masterPlatformRoleId, sha256Hex } from "./support/postgres";

// The dev server compiles a route on its first request.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });

const BASE_URL       = (process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:3000").replace(/\/+$/, "");
const SESSION_COOKIE = "md_platform_session";
const HASH           = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo";
// The heading of the shared access-denied state (src/components/shared/access-denied.tsx).
const DENIED         = "You don&#x27;t have access to this page";

// The privileges of the "limited" custom role: role and user management without delete/suspend.
const LIMITED_KEYS = [
  "platform.tenants.view",
  "platform.roles.view",
  "platform.roles.create",
  "platform.roles.edit",
  "platform.users.view",
  "platform.users.create",
  "platform.users.edit",
];

let devDb: Client | undefined;
let setupError: unknown;
const created  = { roles: [] as string[], owners: [] as string[] };
const label    = randomBytes(4).toString("hex");
let deniedToken  = "";
let limitedToken = "";
let limitedOwner = "";
let masterToken  = "";
let targetRoleId = "";
let targetOwner  = "";
let masterRoleId = "";

/** A GET with the given session cookie (redirects are not followed). */
async function get(pathname: string, token: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    redirect: "manual",
    signal: AbortSignal.timeout(85_000),
  });
  return { status: response.status, body: await response.text() };
}

/** A new owner with this role (Master Platform when omitted); signed in when `signIn`. */
async function owner(roleId: string | undefined, signIn: boolean): Promise<{ ownerId: string; token: string }> {
  if (!devDb) throw new Error("no dev database");
  const ownerId = await insertOwner(devDb, {
    username: `e2e-rbacp-${randomBytes(5).toString("hex")}`,
    passwordHash: HASH,
    ...(roleId ? { roleId } : {}),
  });
  created.owners.push(ownerId);
  if (!signIn) return { ownerId, token: "" };
  const token = randomBytes(32).toString("base64url");
  await insertSession(devDb, { ownerId, tokenHash: sha256Hex(token) });
  return { ownerId, token };
}

/** A throwaway custom platform role. */
async function role(name: string, keys: readonly string[]): Promise<string> {
  if (!devDb) throw new Error("no dev database");
  const id = await insertPlatformRole(devDb, { name: `E2E rbacp ${name} ${label}`, permissionKeys: keys });
  created.roles.push(id);
  return id;
}

/** Everything the suite needs; throws with a clear message. */
async function prepare(): Promise<void> {
  if (process.env.PLATFORM_TEST_ORIGINAL_NODE_ENV === "production") {
    throw new Error("refusing to run the HTTP suite with NODE_ENV=production: it writes throwaway rows");
  }
  const devDatabase = process.env.PLATFORM_TEST_DEV_DATABASE ?? "";
  if (!devDatabase) throw new Error("PLATFORM_TEST_DEV_DATABASE is not set (see vitest.config.ts)");
  devDb = await connectTo(devDatabase);

  masterRoleId = await masterPlatformRoleId(devDb);
  const deniedRole  = await role("denied", ["platform.tenants.view"]);
  const limitedRole = await role("limited", LIMITED_KEYS);
  targetRoleId      = await role("target", ["platform.tenants.view"]);

  ({ token: deniedToken } = await owner(deniedRole, true));
  ({ token: limitedToken, ownerId: limitedOwner } = await owner(limitedRole, true));
  ({ token: masterToken } = await owner(undefined, true));
  ({ ownerId: targetOwner } = await owner(targetRoleId, false));
}

beforeAll(async () => {
  try {
    await prepare();
  } catch (error) {
    setupError = error;
  }
});

beforeEach(() => {
  if (setupError) throw setupError;
});

afterAll(async () => {
  try {
    if (devDb) {
      // Exactly the rows this suite inserted (sessions cascade with their owner).
      for (const id of created.owners) await devDb.query("DELETE FROM platform_owners WHERE id = $1", [id]);
      for (const id of created.roles) await devDb.query("DELETE FROM platform_roles WHERE id = $1 AND system_key IS NULL", [id]);
    }
  } finally {
    await devDb?.end();
  }
});

const PAGES: [string, () => string][] = [
  ["the roles list", () => "/platform/roles"],
  ["the create-role page", () => "/platform/roles/new"],
  ["the role details page", () => `/platform/roles/${targetRoleId}`],
  ["the edit-role page", () => `/platform/roles/${targetRoleId}/edit`],
  ["the Sub-Platform Owners list", () => "/platform/users"],
  ["the add Sub-Platform Owner page", () => "/platform/users/new"],
  ["the edit Sub-Platform Owner page", () => `/platform/users/${targetOwner}/edit`],
];

describe("an owner whose role lacks the role and user privileges", () => {
  it.each(PAGES)("%s answers 200 with the access-denied state and no data", async (_name, pathname) => {
    const response = await get(pathname(), deniedToken);
    expect(response.status).toBe(200);
    expect(response.body).toContain(DENIED);
    expect(response.body).not.toContain(`E2E rbacp target ${label}`);
  });
});

describe("an owner with a custom role holding the privileges", () => {
  it.each(PAGES)("%s renders without the access-denied state", async (_name, pathname) => {
    const response = await get(pathname(), limitedToken);
    expect(response.status).toBe(200);
    expect(response.body).not.toContain(DENIED);
  });

  it("the roles list shows the roles, the summary and Create role", async () => {
    const { body } = await get("/platform/roles", limitedToken);
    expect(body).toContain("Roles &amp; Privileges");
    expect(body).toContain(`E2E rbacp target ${label}`);
    expect(body).toContain("Master Platform");
    expect(body).toContain("Total roles");
    expect(body).toContain('href="/platform/roles/new"');
  });

  it("the create-role page offers only assignable privileges and locks the others", async () => {
    const { body } = await get("/platform/roles/new", limitedToken);
    // Held privileges are checkboxes (their key is the checkbox value).
    for (const key of LIMITED_KEYS) expect(body).toContain(`value="${key}"`);
    // Privileges outside the owner's own set are never checkboxes.
    expect(body).not.toContain('value="platform.tenants.create"');
    expect(body).not.toContain('value="platform.roles.delete"');
    expect(body).toContain("Not assignable");
    expect(body).toContain("Outside your privileges");
  });

  // No loading boundary wraps the `[id]` routes (the list skeletons live in
  // `(list)` route groups and the console has no console-wide loading.tsx), so
  // notFound() answers a real HTTP 404 with the not-found UI; never the data.
  it.each([
    ["an unknown role id", () => `/platform/roles/${randomUUID()}`, "Role not found"],
    ["a malformed role id", () => "/platform/roles/not-a-role-id", "Role not found"],
    ["an unknown role id (edit)", () => `/platform/roles/${randomUUID()}/edit`, "Role not found"],
    ["an unknown account id (edit)", () => `/platform/users/${randomUUID()}/edit`, "Account not found"],
  ])("%s answers 404 with the not-found state (Next.js notFound)", async (_name, pathname, heading) => {
    const response = await get(pathname(), limitedToken);
    expect(response.status).toBe(404);
    expect(response.body).toContain(heading);
    expect(response.body).toMatch(/<meta name="robots" content="noindex"/);
    expect(response.body).not.toContain(DENIED);
  });

  it("the master role cannot be edited and the own account cannot be edited", async () => {
    const masterEdit = await get(`/platform/roles/${masterRoleId}/edit`, limitedToken);
    expect(masterEdit.status).toBe(200);
    expect(masterEdit.body).toContain(DENIED);
    expect(masterEdit.body).toContain("System roles cannot be changed.");

    const ownEdit = await get(`/platform/users/${limitedOwner}/edit`, limitedToken);
    expect(ownEdit.status).toBe(200);
    expect(ownEdit.body).toContain(DENIED);
    expect(ownEdit.body).toContain("You cannot change your own account here.");
  });

  it("the Sub-Platform Owners list shows the add button without a delete-only action", async () => {
    const { body } = await get("/platform/users", limitedToken);
    expect(body).toContain("Sub-Platform Owners");
    expect(body).toContain('href="/platform/users/new"');
    expect(body).toContain("Total Sub-Platform Owners");
  });
});

describe("a Master Platform owner", () => {
  it.each(PAGES)("%s renders without the access-denied state", async (_name, pathname) => {
    const response = await get(pathname(), masterToken);
    expect(response.status).toBe(200);
    expect(response.body).not.toContain(DENIED);
  });
});

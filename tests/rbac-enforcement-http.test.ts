/**
 * RBAC enforcement of the Platform console pages over plain HTTP, against the
 * RUNNING dev server (.vibe/memory/role-privilege-management.md, "Enforcement
 * map"): without `platform.tenants.view` (and the other page privileges) every
 * tenant page answers 200 with the inline access-denied state, the avatar route
 * answers 404 and the sidebar has no Tenant Management link; with them the
 * pages render. A role change between two requests applies on the second one.
 *
 * The dev server reads the development database, so this suite adds two
 * throwaway custom roles, two owners (`e2e-rbac-<random>`), their sessions and
 * one tenant row (+ a tiny profile image file) there, and removes exactly
 * those again. Every statement is scoped to the ids it created.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { permissionKeysOfDomain } from "@/lib/authz/catalog";
import { connectTo, insertOwner, insertPlatformRole, insertSession, insertTenant, sha256Hex } from "./support/postgres";

// The dev server compiles a route on its first request.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const BASE_URL       = (process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:3000").replace(/\/+$/, "");
const SESSION_COOKIE = "md_platform_session";
const HASH           = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo";
// The heading of the shared access-denied state (src/components/shared/access-denied.tsx).
const DENIED         = "You don&#x27;t have access to this page";
// The dev server's storage root (STORAGE_ROOT unset → <cwd>/storage, the same /app in the container).
const STORAGE_ROOT   = path.resolve(process.env.STORAGE_ROOT?.trim() || "storage");

let devDb: Client | undefined;
let setupError: unknown;
const created = { roles: [] as string[], owners: [] as string[], tenantId: "" };
let deniedToken = "";
let allowedToken = "";
let deniedRoleId = "";
let allowedRoleId = "";

/** A GET with the given session cookie (redirects are not followed). */
async function get(pathname: string, token: string): Promise<{ status: number; body: string; location: string | null }> {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    redirect: "manual",
    signal: AbortSignal.timeout(55_000),
  });
  return { status: response.status, body: await response.text(), location: response.headers.get("location") };
}

/** Signs a new owner with this role in (direct session row); returns the cookie value. */
async function ownerWith(roleId: string): Promise<{ ownerId: string; token: string }> {
  if (!devDb) throw new Error("no dev database");
  const ownerId = await insertOwner(devDb, {
    username: `e2e-rbac-${randomBytes(6).toString("hex")}`,
    passwordHash: HASH,
    roleId,
  });
  created.owners.push(ownerId);
  const token = randomBytes(32).toString("base64url");
  await insertSession(devDb, { ownerId, tokenHash: sha256Hex(token) });
  return { ownerId, token };
}

/** Everything the suite needs; throws with a clear message. */
async function prepare(): Promise<void> {
  if (process.env.PLATFORM_TEST_ORIGINAL_NODE_ENV === "production") {
    throw new Error("refusing to run the HTTP suite with NODE_ENV=production: it writes throwaway rows");
  }
  const devDatabase = process.env.PLATFORM_TEST_DEV_DATABASE ?? "";
  if (!devDatabase) throw new Error("PLATFORM_TEST_DEV_DATABASE is not set (see vitest.config.ts)");
  devDb = await connectTo(devDatabase);

  // A role WITHOUT any tenant privilege, and one with every platform privilege.
  const label = randomBytes(4).toString("hex");
  deniedRoleId  = await insertPlatformRole(devDb, { name: `E2E rbac denied ${label}`, permissionKeys: ["platform.roles.view"] });
  allowedRoleId = await insertPlatformRole(devDb, {
    name: `E2E rbac allowed ${label}`,
    permissionKeys: permissionKeysOfDomain("platform"),
  });
  created.roles.push(deniedRoleId, allowedRoleId);

  ({ token: deniedToken } = await ownerWith(deniedRoleId));
  ({ token: allowedToken } = await ownerWith(allowedRoleId));

  // One tenant with a stored profile image (bytes are never sniffed when served).
  created.tenantId = await insertTenant(devDb, { slug: `e2e-rbac-${label}` });
  const key = `tenants/${created.tenantId}/profile/${randomUUID()}.png`;
  await mkdir(path.dirname(path.join(STORAGE_ROOT, key)), { recursive: true });
  await writeFile(path.join(STORAGE_ROOT, key), Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"));
  await devDb.query("UPDATE tenants SET profile_image_key = $2 WHERE id = $1", [created.tenantId, key]);
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
      if (created.tenantId) {
        await devDb.query("DELETE FROM tenants WHERE id = $1", [created.tenantId]);
        await rm(path.join(STORAGE_ROOT, "tenants", created.tenantId), { recursive: true, force: true });
      }
    }
  } finally {
    await devDb?.end();
  }
});

const TENANT_PAGES = (id: () => string): [string, () => string][] => [
  ["the directory", () => "/platform/tenants"],
  ["the details page", () => `/platform/tenants/${id()}`],
  ["the edit page", () => `/platform/tenants/${id()}/edit`],
  ["the create page", () => "/platform/tenants/new"],
  ["the registrations page", () => `/platform/tenants/${id()}/registrations`],
];

describe("an owner whose role lacks the tenant privileges", () => {
  it.each(TENANT_PAGES(() => created.tenantId))("%s answers 200 with the access-denied state", async (_name, pathname) => {
    const response = await get(pathname(), deniedToken);
    expect(response.status).toBe(200);
    expect(response.body).toContain(DENIED);
    // No tenant data reaches the page.
    expect(response.body).not.toContain("Test e2e-rbac-");
  });

  it("the avatar route answers 404", async () => {
    const response = await get(`/platform/tenants/${created.tenantId}/avatar`, deniedToken);
    expect(response.status).toBe(404);
  });

  it("the sidebar and dashboard have no Tenant Management link; the role name is shown", async () => {
    const response = await get("/platform/dashboard", deniedToken);
    expect(response.status).toBe(200);
    expect(response.body).not.toContain('href="/platform/tenants"');
    expect(response.body).not.toContain("Manage tenants");
    // Roles & Privileges is granted to this role, so it is listed.
    expect(response.body).toContain('href="/platform/roles"');
    expect(response.body).toContain("E2E rbac denied");
  });
});

describe("an owner whose role has every platform privilege", () => {
  it.each(TENANT_PAGES(() => created.tenantId))("%s renders without the access-denied state", async (_name, pathname) => {
    const response = await get(pathname(), allowedToken);
    expect(response.status).toBe(200);
    expect(response.body).not.toContain(DENIED);
  });

  it("the avatar route serves the image", async () => {
    const response = await get(`/platform/tenants/${created.tenantId}/avatar`, allowedToken);
    expect(response.status).toBe(200);
  });

  it("the sidebar lists Tenant Management, Sub-Platform Owners and the Modules setting", async () => {
    const response = await get("/platform/dashboard", allowedToken);
    expect(response.body).toContain('href="/platform/tenants"');
    expect(response.body).toContain('href="/platform/users"');
    expect(response.body).toContain('href="/platform/settings/modules"');
  });
});

describe("a role change between two requests", () => {
  it("applies on the very next request, without signing in again", async () => {
    if (!devDb) throw new Error("no dev database");
    const { ownerId, token } = await ownerWith(allowedRoleId);
    expect((await get("/platform/tenants", token)).body).not.toContain(DENIED);

    await devDb.query("UPDATE platform_owners SET role_id = $2 WHERE id = $1", [ownerId, deniedRoleId]);
    const after = await get("/platform/tenants", token);
    expect(after.status).toBe(200);
    expect(after.body).toContain(DENIED);
  });
});

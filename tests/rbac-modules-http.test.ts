/**
 * The module switch pages over plain HTTP, against the RUNNING dev server
 * (.vibe/memory/role-privilege-management.md, "Module switches"):
 *
 *   - /platform/settings/modules answers 200 with the access-denied state
 *     without `platform.modules.manage`, and lists the platform modules with
 *     switches and locked core modules with it;
 *   - the tenant details page shows the "Module access" section to everyone
 *     who may open it: read-only without `platform.tenant_modules.manage`,
 *     with switches with it.
 *
 * The dev server reads the development database, so this suite adds three
 * throwaway custom roles, three owners (`e2e-rbacmod-<random>`), their
 * sessions and one tenant row there, and removes exactly those again. It
 * never writes a module setting.
 */
import { randomBytes } from "node:crypto";
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
// The markup of a Radix switch (src/components/ui/switch.tsx).
const SWITCH         = 'role="switch"';

let devDb: Client | undefined;
let setupError: unknown;
const created = { roles: [] as string[], owners: [] as string[], tenantId: "" };
const tokens  = { none: "", viewOnly: "", all: "" };

/** A GET with the given session cookie (redirects are not followed). */
async function get(pathname: string, token: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    redirect: "manual",
    signal: AbortSignal.timeout(55_000),
  });
  return { status: response.status, body: await response.text() };
}

/** A new owner holding a new custom role with exactly these privileges; returns the cookie value. */
async function ownerWith(label: string, keys: readonly string[]): Promise<string> {
  if (!devDb) throw new Error("no dev database");
  const roleId = await insertPlatformRole(devDb, { name: `E2E rbacmod ${label} ${randomBytes(4).toString("hex")}`, permissionKeys: keys });
  created.roles.push(roleId);
  const ownerId = await insertOwner(devDb, { username: `e2e-rbacmod-${randomBytes(6).toString("hex")}`, passwordHash: HASH, roleId });
  created.owners.push(ownerId);
  const token = randomBytes(32).toString("base64url");
  await insertSession(devDb, { ownerId, tokenHash: sha256Hex(token) });
  return token;
}

/** Everything the suite needs; throws with a clear message. */
async function prepare(): Promise<void> {
  if (process.env.PLATFORM_TEST_ORIGINAL_NODE_ENV === "production") {
    throw new Error("refusing to run the HTTP suite with NODE_ENV=production: it writes throwaway rows");
  }
  const devDatabase = process.env.PLATFORM_TEST_DEV_DATABASE ?? "";
  if (!devDatabase) throw new Error("PLATFORM_TEST_DEV_DATABASE is not set (see vitest.config.ts)");
  devDb = await connectTo(devDatabase);

  tokens.none     = await ownerWith("none", ["platform.roles.view"]);
  tokens.viewOnly = await ownerWith("view", ["platform.tenants.view"]);
  tokens.all      = await ownerWith("all", permissionKeysOfDomain("platform"));
  created.tenantId = await insertTenant(devDb, { slug: `e2e-rbacmod-${randomBytes(4).toString("hex")}` });
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
      if (created.tenantId) await devDb.query("DELETE FROM tenants WHERE id = $1", [created.tenantId]);
    }
  } finally {
    await devDb?.end();
  }
});

describe("/platform/settings/modules", () => {
  it("answers 200 with the access-denied state without platform.modules.manage", async () => {
    for (const token of [tokens.none, tokens.viewOnly]) {
      const response = await get("/platform/settings/modules", token);
      expect(response.status).toBe(200);
      expect(response.body).toContain(DENIED);
      expect(response.body).not.toContain(SWITCH);
      expect(response.body).not.toContain("Core · always on");
    }
  });

  it("lists the platform modules with switches and locked core modules", async () => {
    const response = await get("/platform/settings/modules", tokens.all);
    expect(response.status).toBe(200);
    expect(response.body).not.toContain(DENIED);
    expect(response.body).toContain("Tenant Management");
    expect(response.body).toContain("Platform Modules");
    expect(response.body).toContain("Core · always on");
    expect(response.body).toContain(SWITCH);
  });
});

describe("the tenant details page's Module access section", () => {
  it("is read-only without platform.tenant_modules.manage", async () => {
    const response = await get(`/platform/tenants/${created.tenantId}`, tokens.viewOnly);
    expect(response.status).toBe(200);
    expect(response.body).toContain("Module Access");
    expect(response.body).toContain("Tenant panel");
    expect(response.body).toContain("Customer panel");
    expect(response.body).toContain("Core · always on");
    expect(response.body).not.toContain(SWITCH);
  });

  it("has switches with platform.tenant_modules.manage", async () => {
    const response = await get(`/platform/tenants/${created.tenantId}`, tokens.all);
    expect(response.status).toBe(200);
    expect(response.body).toContain("Module Access");
    expect(response.body).toContain(SWITCH);
  });

  it("is not shown at all without platform.tenants.view", async () => {
    const response = await get(`/platform/tenants/${created.tenantId}`, tokens.none);
    expect(response.status).toBe(200);
    expect(response.body).toContain(DENIED);
    expect(response.body).not.toContain("Module Access");
  });
});

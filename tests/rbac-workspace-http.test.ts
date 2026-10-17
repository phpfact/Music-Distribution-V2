/**
 * The Tenant and Customer RBAC pages over plain HTTP on a REAL tenant host,
 * against the RUNNING dev server (.vibe/memory/role-privilege-management.md,
 * "Technical Notes" → "RBAC pages (all panels)"): every page answers the inline
 * access-denied state without its privilege and renders with it (Master
 * Tenant / Master Customer vs. a custom role), unknown or foreign ids answer
 * 404, and a customer session never opens a tenant page.
 *
 * How the tenant reaches the dev server: the tenant is created and
 * provisioned in the scratch control plane (a real t_test_ database), then its
 * tenant row, subdomain row and encrypted database secret are COPIED into the
 * dev server's control database so the Host header resolves. Exactly those
 * rows (by id) are deleted again; the t_test_ database and role are dropped by
 * TenantResources. Nothing else in the dev database is touched; GET requests
 * only (no audit rows are written there).
 *
 * `fetch` may not set the Host header, so requests use node:http.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { request } from "node:http";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { permissionKeysOfDomain } from "@/lib/authz/catalog";
import { createUserSession } from "@/lib/workspace/sessions";
import { closeAppDatabase } from "./support/app-connections";
import { clearPlatformTables, clearTenantTables, connectTo, connectToTestDatabase } from "./support/postgres";
import { approvedCustomer, assignRole, closeRbacTenant, insertCustomer, insertRole, insertUser, openRbacTenant, type RbacTenant } from "./support/rbac";
import { TenantResources } from "./support/tenant-resources";

// Provisioning takes a while; the dev server compiles each route on its first request.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 240_000 });

const BASE_URL    = new URL(process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:3000");
const BASE_DOMAIN = process.env.PLATFORM_BASE_DOMAIN?.trim() || "localhost";
const PORT_SUFFIX = BASE_URL.port ? `:${BASE_URL.port}` : "";
// The heading of the shared access-denied state (HTML-escaped apostrophe).
const DENIED      = "You don&#x27;t have access to this page";

let control: Client;
let devDb: Client | undefined;
let resources: TenantResources;
let t: RbacTenant;
let host = "";
const copied = { tenantId: "", secretId: "", domainIds: [] as string[] };

// Session tokens of the people the pages are opened as.
const tokens = { master: "", clerk: "", customerMaster: "", subCustomer: "", foreign: "" };
// Ids the pages are opened with.
const ids = { customRole: "", staffUser: "", customerRole: "", subCustomerUser: "", foreignRole: "", foreignSubUser: "" };

/** One GET on the tenant host with a cookie; resolves with status, location and body. */
function get(path: string, cookie: string): Promise<{ status: number; location: string | null; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        hostname: BASE_URL.hostname,
        port: BASE_URL.port || 80,
        path,
        method: "GET",
        headers: { Host: host, Cookie: cookie },
        timeout: 85_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            location: (response.headers.location as string | undefined) ?? null,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        response.on("error", reject);
      },
    );
    outgoing.on("timeout", () => outgoing.destroy(new Error("request timed out")));
    outgoing.on("error", reject);
    outgoing.end();
  });
}

/** The tenant-area cookie of a token. */
const staffCookie = (token: string) => `md_tenant_session=${token}`;
/** The customer-area cookie of a token. */
const customerCookie = (token: string) => `md_customer_session=${token}`;

/** Copies the provisioned tenant's control-plane rows into the dev database (see the module comment). */
async function copyTenantToDev(db: Client): Promise<void> {
  // Step 1: the encrypted database secret (same TENANT_SECRETS_KEY in this container).
  const tenant = (await control.query<{ database_secret_ref: string }>("SELECT database_secret_ref FROM tenants WHERE id = $1", [t.tenant.id])).rows[0];
  if (!tenant) throw new Error("tenant row missing");
  const secret = (await control.query("SELECT id, purpose, key_version, nonce, ciphertext, auth_tag FROM secrets WHERE id = $1", [tenant.database_secret_ref])).rows[0];
  await db.query(
    "INSERT INTO secrets (id, purpose, key_version, nonce, ciphertext, auth_tag) VALUES ($1, $2, $3, $4, $5, $6)",
    [secret.id, secret.purpose, secret.key_version, secret.nonce, secret.ciphertext, secret.auth_tag],
  );
  copied.secretId = secret.id as string;

  // Step 2: the tenant row, on the dev database's default plan.
  const plan = (await db.query<{ id: string }>("SELECT id FROM plans WHERE is_default LIMIT 1")).rows[0];
  if (!plan) throw new Error("the dev database has no default plan");
  const row = (await control.query("SELECT * FROM tenants WHERE id = $1", [t.tenant.id])).rows[0] as Record<string, unknown>;
  const columns = Object.keys(row);
  const values  = columns.map((column) => (column === "plan_id" ? plan.id : row[column]));
  await db.query(
    `INSERT INTO tenants (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})`,
    values,
  );
  copied.tenantId = t.tenant.id;

  // Step 3: its domain rows (the subdomain is what the Host header names).
  const domains = (await control.query("SELECT * FROM tenant_domains WHERE tenant_id = $1", [t.tenant.id])).rows as Record<string, unknown>[];
  for (const domain of domains) {
    const keys = Object.keys(domain);
    await db.query(
      `INSERT INTO tenant_domains (${keys.map((key) => `"${key}"`).join(", ")}) VALUES (${keys.map((_, index) => `$${index + 1}`).join(", ")})`,
      keys.map((key) => domain[key]),
    );
    copied.domainIds.push(domain.id as string);
    if (domain.type === "subdomain") host = `${String(domain.hostname)}.${BASE_DOMAIN}${PORT_SUFFIX}`;
  }
  if (!host) throw new Error("no subdomain row");
}

/** Removes exactly the rows copyTenantToDev wrote. */
async function removeTenantFromDev(db: Client): Promise<void> {
  if (copied.domainIds.length > 0) await db.query("DELETE FROM tenant_domains WHERE id = ANY($1::uuid[])", [copied.domainIds]);
  if (copied.tenantId) await db.query("DELETE FROM tenants WHERE id = $1", [copied.tenantId]);
  if (copied.secretId) await db.query("DELETE FROM secrets WHERE id = $1", [copied.secretId]);
}

beforeAll(async () => {
  if (process.env.PLATFORM_TEST_ORIGINAL_NODE_ENV === "production") {
    throw new Error("refusing to run the HTTP suite with NODE_ENV=production: it writes throwaway rows");
  }
  const devDatabase = process.env.PLATFORM_TEST_DEV_DATABASE ?? "";
  if (!devDatabase) throw new Error("PLATFORM_TEST_DEV_DATABASE is not set (see vitest.config.ts)");

  // Step 1: a real tenant (scratch control plane + t_test_ database), visible to the dev server.
  control = await connectToTestDatabase();
  await clearPlatformTables(control);
  await clearTenantTables(control);
  resources = await TenantResources.open(control);
  t         = await openRbacTenant("rbachttp", randomUUID());
  devDb     = await connectTo(devDatabase);
  await copyTenantToDev(devDb);

  // Step 2: staff — the primary admin (Master Tenant) and a clerk with a custom role of
  // no access-control privilege; a custom role and a staff user to open by id.
  tokens.master = await createUserSession(t.ws.db, t.tenant.id, t.adminId, "tenant");
  ids.customRole = await insertRole(t.rt, { name: `VT Http Clerk ${randomBytes(3).toString("hex")}`, domain: "tenant", keys: ["tenant.registrations.view"] });
  const clerk    = await insertUser(t.rt, { handle: "clerk" });
  await assignRole(t.rt, clerk, ids.customRole);
  tokens.clerk  = await createUserSession(t.ws.db, t.tenant.id, clerk, "tenant");
  ids.staffUser = await insertUser(t.rt, { handle: "staff" });
  await assignRole(t.rt, ids.staffUser, ids.customRole);

  // Step 3: customers — main customer X (Master Customer), a sub-customer of X without
  // access-control privileges, and a foreign main customer Y with its own role and sub-customer.
  const x = await approvedCustomer(t, "Http Xena Label");
  tokens.customerMaster = await createUserSession(t.ws.db, t.tenant.id, x.userId, "customer");
  ids.customerRole = await insertRole(t.rt, { name: `VT Http X ${randomBytes(3).toString("hex")}`, domain: "customer", owner: x.customerId, keys: ["customer.sub_customers.view"] });
  const subCustomer = await insertCustomer(t.rt, "Http Sub Customer", x.customerId);
  ids.subCustomerUser = await insertUser(t.rt, { handle: "subcust", customerId: subCustomer });
  const plainRole = await insertRole(t.rt, { name: `VT Http Plain ${randomBytes(3).toString("hex")}`, domain: "customer", owner: x.customerId, keys: [] });
  await assignRole(t.rt, ids.subCustomerUser, plainRole);
  tokens.subCustomer = await createUserSession(t.ws.db, t.tenant.id, ids.subCustomerUser, "customer");

  const y = await approvedCustomer(t, "Http Yara Label");
  ids.foreignRole = await insertRole(t.rt, { name: `VT Http Y ${randomBytes(3).toString("hex")}`, domain: "customer", owner: y.customerId, keys: ["customer.roles.view"] });
  const ySub = await insertCustomer(t.rt, "Http Y Sub", y.customerId);
  ids.foreignSubUser = await insertUser(t.rt, { handle: "ysub", customerId: ySub });
  await assignRole(t.rt, ids.foreignSubUser, ids.foreignRole);
  tokens.foreign = await createUserSession(t.ws.db, t.tenant.id, y.userId, "customer");
});

afterAll(async () => {
  if (devDb) await removeTenantFromDev(devDb).catch(() => undefined);
  await devDb?.end().catch(() => undefined);
  await closeRbacTenant(t);
  await resources?.cleanup();
  await clearTenantTables(control);
  await clearPlatformTables(control);
  await resources?.close();
  await control?.end();
  await closeAppDatabase();
});

describe("tenant RBAC pages", () => {
  const pages = (): [path: string, rendered: string][] => [
    ["/tenant/roles", "Role directory"],
    ["/tenant/roles/new", "id=\"role-name\""],
    [`/tenant/roles/${ids.customRole}`, "Assigned users"],
    [`/tenant/roles/${ids.customRole}/edit`, "Save role"],
    ["/tenant/users", "Add Sub-Tenant"],
    ["/tenant/users/new", "Create sub-tenant"],
    [`/tenant/users/${ids.staffUser}/edit`, "Save changes"],
  ];

  it("answer the access-denied state without the privilege and render with Master Tenant", async () => {
    for (const [path, rendered] of pages()) {
      const denied = await get(path, staffCookie(tokens.clerk));
      expect(denied.status, path).toBe(200);
      expect(denied.body, path).toContain(DENIED);
      expect(denied.body, path).not.toContain(rendered);

      const allowed = await get(path, staffCookie(tokens.master));
      expect(allowed.status, path).toBe(200);
      expect(allowed.body, path).not.toContain(DENIED);
      expect(allowed.body, path).toContain(rendered);
    }
  });

  it("render with a custom role that holds exactly the page privileges (records within its ceiling)", async () => {
    const keys = permissionKeysOfDomain("tenant").filter((key) => key.startsWith("tenant.roles.") || key.startsWith("tenant.users."));
    const role = await insertRole(t.rt, { name: `VT Http Admin ${randomBytes(3).toString("hex")}`, domain: "tenant", keys });
    const user = await insertUser(t.rt, { handle: "admin2" });
    await assignRole(t.rt, user, role);
    const token = await createUserSession(t.ws.db, t.tenant.id, user, "tenant");

    // A role and an account inside this custom role's ceiling, so edit pages open.
    const smallRole = await insertRole(t.rt, { name: `VT Http Small ${randomBytes(3).toString("hex")}`, domain: "tenant", keys: ["tenant.users.view"] });
    const member    = await insertUser(t.rt, { handle: "member" });
    await assignRole(t.rt, member, smallRole);
    const allowed: [string, string][] = [
      ["/tenant/roles", "Role directory"],
      ["/tenant/roles/new", 'id="role-name"'],
      [`/tenant/roles/${smallRole}`, "Assigned users"],
      [`/tenant/roles/${smallRole}/edit`, "Save role"],
      ["/tenant/users", "Add Sub-Tenant"],
      ["/tenant/users/new", "Create sub-tenant"],
      [`/tenant/users/${member}/edit`, "Save changes"],
    ];
    for (const [path, rendered] of allowed) {
      const response = await get(path, staffCookie(token));
      expect(response.status, path).toBe(200);
      expect(response.body, path).toContain(rendered);
    }

    // Records above its ceiling are viewable but never editable: the edit pages explain why.
    for (const path of [`/tenant/roles/${ids.customRole}/edit`, `/tenant/users/${ids.staffUser}/edit`]) {
      const response = await get(path, staffCookie(token));
      expect(response.status, path).toBe(200);
      expect(response.body, path).toContain(DENIED);
      expect(response.body, path).toContain("beyond your own");
    }
  });

  it("answer 404 for an unknown or malformed id", async () => {
    for (const path of [
      `/tenant/roles/${randomUUID()}`,
      `/tenant/roles/${randomUUID()}/edit`,
      `/tenant/users/${randomUUID()}/edit`,
      "/tenant/roles/not-a-uuid",
    ]) {
      const response = await get(path, staffCookie(tokens.master));
      expect(response.status, path).toBe(404);
    }
  });

  it("never open for a customer session (redirect to the login page)", async () => {
    for (const path of ["/tenant/roles", "/tenant/users"]) {
      const response = await get(path, customerCookie(tokens.customerMaster));
      expect([302, 303, 307, 308], path).toContain(response.status);
      expect(response.location, path).toMatch(/\/login$/);
    }
  });
});

describe("customer RBAC pages", () => {
  const pages = (): [path: string, rendered: string][] => [
    ["/customer/roles", "Role directory"],
    ["/customer/roles/new", "id=\"role-name\""],
    [`/customer/roles/${ids.customerRole}`, "Assigned users"],
    [`/customer/roles/${ids.customerRole}/edit`, "Save role"],
    ["/customer/sub-customers", "Add Sub-Customer"],
    ["/customer/sub-customers/new", "Create sub-customer"],
    [`/customer/sub-customers/${ids.subCustomerUser}/edit`, "Save changes"],
  ];

  it("answer the access-denied state without the privilege and render with Master Customer", async () => {
    for (const [path, rendered] of pages()) {
      const denied = await get(path, customerCookie(tokens.subCustomer));
      expect(denied.status, path).toBe(200);
      expect(denied.body, path).toContain(DENIED);
      expect(denied.body, path).not.toContain(rendered);

      const allowed = await get(path, customerCookie(tokens.customerMaster));
      expect(allowed.status, path).toBe(200);
      expect(allowed.body, path).not.toContain(DENIED);
      expect(allowed.body, path).toContain(rendered);
    }
  });

  it("answer 404 for another main customer's role or sub-customer and for unknown ids", async () => {
    for (const path of [
      `/customer/roles/${ids.foreignRole}`,
      `/customer/roles/${ids.foreignRole}/edit`,
      `/customer/sub-customers/${ids.foreignSubUser}/edit`,
      `/customer/roles/${randomUUID()}`,
      `/customer/sub-customers/${randomUUID()}/edit`,
    ]) {
      const response = await get(path, customerCookie(tokens.customerMaster));
      expect(response.status, path).toBe(404);
    }
    // The foreign main customer sees its own role, never X's.
    expect((await get(`/customer/roles/${ids.foreignRole}`, customerCookie(tokens.foreign))).status).toBe(200);
    expect((await get(`/customer/roles/${ids.customerRole}`, customerCookie(tokens.foreign))).status).toBe(404);
  });

  it("never open for a staff session (redirect to the login page)", async () => {
    const response = await get("/customer/roles", staffCookie(tokens.master));
    expect([302, 303, 307, 308]).toContain(response.status);
    expect(response.location).toMatch(/\/login$/);
  });
});

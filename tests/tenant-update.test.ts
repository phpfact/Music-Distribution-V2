/**
 * Editing tenants, changing their credentials and checking their domains
 * (docs/tenant-management.md §8.4, §8.5, §7.2) against the scratch control
 * database, the dev PostgreSQL server and Redis.
 *
 * Tenant names start with "Test ", so every database and role provisioning
 * creates is named t_test_...; the last test drops exactly those and proves
 * the server's databases and roles are what they were before
 * (tests/support/tenant-resources.ts). DNS is never asked: the checks get a
 * fake resolver. Rate-limit counters are keyed by owner id; this file deletes
 * the keys of the ids it used.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Client } from "pg";
import { escapeIdentifier, escapeLiteral } from "pg";
import { createClient } from "redis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getControlDb } from "@/lib/db/control";
import type { DnsResolver } from "@/lib/domains/dns";
import { hashPassword, verifyPassword } from "@/lib/platform-auth/password";
import { testDatabaseLogin } from "@/lib/provisioning";
import { scramSha256Verifier } from "@/lib/provisioning/scram";
import { readSecret } from "@/lib/secrets";
import {
  createTenant,
  type CreateTenantInput,
  getTenantForEdit,
  recheckSubdomain,
  resetMasterPassword,
  rotateDatabasePassword,
  startProvisioning,
  type TenantActor,
  updateExistingDatabasePassword,
  type UpdateTenantInput,
  updateTenantProfile,
  verifyCustomDomain,
} from "@/lib/tenants/service";
import { closeAppDatabase, closeAppRedis } from "./support/app-connections";
import { captureConsole } from "./support/console";
import { clearTenantTables, connectTo, connectToTestDatabase, insertOwner } from "./support/postgres";
import {
  insertProvisioningTenant,
  postgresPort,
  randomLabel,
  TenantResources,
  testIdentifiers,
} from "./support/tenant-resources";

const SLOW = { timeout: 120_000 };
const BASE_DOMAIN = process.env.PLATFORM_BASE_DOMAIN?.trim() || "localhost";
const LOCALHOST_BASE = BASE_DOMAIN === "localhost" || BASE_DOMAIN.endsWith(".localhost");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const RATE_LIMIT_PREFIXES = [
  "tenant-create",
  "tenant-admin-password",
  "tenant-db-rotate",
  "tenant-db-password",
  "tenant-domain-check",
];

let db: Client;
let resources: TenantResources;
let redis: ReturnType<typeof createClient>;
let consoleOutput: { text: () => string };
let inventoryBefore: { databases: string[]; roles: string[] };
let storageRoot: string;
let ownerId: string;

const usedOwnerIds = new Set<string>();
// Every secret value the tests know of: none may appear in a result or the log.
const secrets = new Set<string>();
// Results returned by the services, checked for secrets at the end.
const observed: unknown[] = [];

function actor(id: string = ownerId): TenantActor {
  usedOwnerIds.add(id);
  return { ownerId: id, ipAddress: "203.0.113.9" };
}

function freshActor(): TenantActor {
  return actor(randomUUID());
}

/** DNS answers from a table: TXT records by name, every host resolves unless listed as missing. */
function fakeResolver(txt: Record<string, string[]> = {}, missing: string[] = []): DnsResolver {
  const notFound = () => Object.assign(new Error("not found"), { code: "ENOTFOUND" });
  return {
    async lookup(host) {
      if (missing.includes(host)) throw notFound();
      return ["203.0.113.10"];
    },
    async resolveTxt(name) {
      const records = txt[name];
      if (!records) throw notFound();
      return records.map((record) => [record]);
    },
  };
}

beforeAll(async () => {
  storageRoot = await mkdtemp(path.join(os.tmpdir(), "vt-tenant-storage-"));
  process.env.STORAGE_ROOT = storageRoot;

  db = await connectToTestDatabase();
  await clearTenantTables(db);
  resources = await TenantResources.open(db);
  inventoryBefore = await resources.inventory();
  ownerId = await insertOwner(db, {
    username: `vt-owner-${randomLabel(8)}`,
    passwordHash: await hashPassword(randomBytes(16).toString("base64url")),
  });

  redis = createClient({
    socket: {
      host: process.env.REDIS_HOST?.trim(),
      port: Number(process.env.REDIS_PORT?.trim() || "6379"),
      connectTimeout: 5_000,
    },
    password: process.env.REDIS_PASSWORD?.trim(),
  });
  redis.on("error", () => undefined);
  await redis.connect();

  consoleOutput = captureConsole();
  for (const name of ["POSTGRES_PASSWORD", "TENANT_SECRETS_KEY", "REDIS_PASSWORD"]) {
    const value = process.env[name];
    if (value) secrets.add(value);
  }
});

afterEach(async () => {
  for (const id of usedOwnerIds) {
    for (const prefix of RATE_LIMIT_PREFIXES) await redis.del(`rl:${prefix}:${id}`);
  }
});

afterAll(async () => {
  vi.restoreAllMocks();
  await resources.cleanup();
  await clearTenantTables(db);
  if (ownerId) await db.query("DELETE FROM platform_owners WHERE id = $1", [ownerId]);
  await resources.close();
  await db.end();
  redis.destroy();
  await closeAppDatabase();
  await closeAppRedis();
  if (storageRoot?.startsWith(path.join(os.tmpdir(), "vt-tenant-storage-"))) {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helpers

function manualInput(label: string, overrides: Partial<CreateTenantInput> = {}): CreateTenantInput {
  const token = randomLabel(6);
  const names = testIdentifiers(label);
  const input: CreateTenantInput = {
    fullName: `Test ${label} ${token}`,
    phone: "+44 20 7946 0958",
    username: `test-${label}-${token}`,
    email: `test-${label}-${token}@example.com`,
    masterPassword: `Mp-${randomBytes(12).toString("base64url")}`,
    databaseName: names.database,
    databaseUser: names.user,
    databasePassword: randomBytes(24).toString("base64url"),
    databasePort: "",
    subdomain: `test-${label}-${token}`,
    customDomain: "",
    credentialMode: "manual",
    databaseMode: "provisioned",
    profileImage: null,
    ...overrides,
  };
  secrets.add(input.masterPassword);
  secrets.add(input.databasePassword);
  return input;
}

async function createOk(input: CreateTenantInput): Promise<string> {
  const result = await createTenant(input, actor());
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result)}`);
  return result.tenantId;
}

/** The edit form as the page would prefill it, with some values changed. */
async function editInput(id: string, overrides: Partial<UpdateTenantInput> = {}): Promise<UpdateTenantInput> {
  const current = await getTenantForEdit(id);
  if (!current) throw new Error("no tenant to edit");
  observed.push(current);
  return {
    fullName: current.fullName,
    phone: current.phone ?? "",
    email: current.email,
    username: current.username,
    subdomain: current.subdomain,
    customDomain: current.customDomain ?? "",
    profileImage: { action: "keep" },
    ...overrides,
  };
}

async function update(id: string, overrides: Partial<UpdateTenantInput>, resolver = fakeResolver()) {
  const result = await updateTenantProfile(id, await editInput(id, overrides), actor(), { dnsResolver: resolver });
  observed.push(result);
  return result;
}

type TenantRow = {
  name: string;
  slug: string;
  phone: string | null;
  contact_email: string;
  admin_username: string;
  profile_image_key: string | null;
  pending_admin_password_hash: string | null;
  database_secret_ref: string;
  database_name: string;
  database_user: string;
  status: string;
};

async function tenantRow(id: string): Promise<TenantRow> {
  const result = await db.query<TenantRow>(
    `SELECT name, slug, phone, contact_email, admin_username, profile_image_key, pending_admin_password_hash,
            database_secret_ref, database_name, database_user, status::text
     FROM tenants WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new Error("no tenant row");
  return row;
}

type DomainRow = {
  id: string;
  hostname: string;
  status: string;
  verification_token: string | null;
  verified_at: Date | null;
  last_checked_at: Date | null;
  last_check_error: string | null;
};

async function domainRow(id: string, type: "subdomain" | "custom"): Promise<DomainRow | undefined> {
  const result = await db.query<DomainRow>(
    `SELECT id, hostname, status::text, verification_token, verified_at, last_checked_at, last_check_error
     FROM tenant_domains WHERE tenant_id = $1 AND type = $2::tenant_domain_type`,
    [id, type],
  );
  return result.rows[0];
}

async function auditEvents(id: string, action: string): Promise<{ metadata: Record<string, unknown> | null }[]> {
  const result = await db.query<{ metadata: Record<string, unknown> | null }>(
    "SELECT metadata FROM audit_events WHERE tenant_id = $1 AND action = $2 ORDER BY occurred_at, id",
    [id, action],
  );
  return result.rows;
}

async function setStatus(id: string, status: string): Promise<void> {
  await db.query("UPDATE tenants SET status = $2::tenant_status WHERE id = $1", [id, status]);
}

async function fileExists(key: string): Promise<boolean> {
  try {
    await access(path.join(storageRoot, key));
    return true;
  } catch {
    return false;
  }
}

async function adminRows(database: string): Promise<{ username: string | null; email: string; password_hash: string | null }[]> {
  return resources.queryIn(database, "SELECT username, email, password_hash FROM users ORDER BY created_at, id");
}

// ---------------------------------------------------------------------------

describe("getTenantForEdit", () => {
  it("returns the persisted values and nothing secret", async () => {
    const input = manualInput("form", { customDomain: `form-${randomLabel(6)}.example.com`, profileImage: { bytes: PNG } });
    const id = await createOk(input);
    const form = await getTenantForEdit(id);
    observed.push(form);
    expect(form).toStrictEqual({
      id,
      status: "pending",
      fullName: input.fullName,
      phone: "+442079460958",
      email: input.email,
      username: input.username,
      subdomain: input.subdomain,
      customDomain: input.customDomain,
      hasProfileImage: true,
      adminAccountExists: false,
      baseDomain: BASE_DOMAIN,
    });
  });

  it("is null for an unknown or malformed id", async () => {
    expect(await getTenantForEdit(randomUUID())).toBeNull();
    expect(await getTenantForEdit("not-a-uuid")).toBeNull();
  });
});

describe("updateTenantProfile", () => {
  it("writes only the changed fields and audits their names, never their values", async () => {
    const id = await createOk(manualInput("edit"));
    const before = await tenantRow(id);
    const newName = `Test Renamed ${randomLabel(6)}`;

    const result = await update(id, { fullName: `  ${newName}  `, phone: "+1 (555) 010-9999" });
    expect(result).toStrictEqual({ ok: true, tenantId: id, changed: ["fullName", "phone"], dnsPending: false });

    const after = await tenantRow(id);
    expect(after).toStrictEqual({ ...before, name: newName, phone: "+15550109999" });
    const events = await auditEvents(id, "tenant.updated");
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toStrictEqual({ fields: ["fullName", "phone"] });
    expect(JSON.stringify(events)).not.toContain(newName);

    // Submitting the same values again changes and audits nothing.
    expect(await update(id, {})).toStrictEqual({ ok: true, tenantId: id, changed: [], dnsPending: false });
    expect(await auditEvents(id, "tenant.updated")).toHaveLength(1);
  });

  it("validates every field with the create rules, all at once", async () => {
    const id = await createOk(manualInput("invalid"));
    const before = await tenantRow(id);
    const result = await update(id, {
      fullName: " ",
      phone: "12",
      email: "nope",
      username: "-x",
      subdomain: "admin",
      customDomain: "localhost",
      profileImage: { action: "replace", bytes: new Uint8Array([1, 2, 3]) },
    });
    if (result.ok || result.reason !== "validation") throw new Error(JSON.stringify(result));
    expect(Object.keys(result.fieldErrors).sort()).toStrictEqual(
      ["customDomain", "email", "fullName", "phone", "profileImage", "subdomain", "username"].sort(),
    );
    expect(await tenantRow(id)).toStrictEqual(before);
  });

  it("refuses names another tenant holds, but not the tenant's own", async () => {
    const other = manualInput("holder", { customDomain: `holder-${randomLabel(6)}.example.com` });
    await createOk(other);
    const id = await createOk(manualInput("taker"));
    const before = await tenantRow(id);

    const result = await update(id, {
      username: other.username.toUpperCase(),
      email: other.email,
      subdomain: other.subdomain,
      customDomain: other.customDomain,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "validation",
      fieldErrors: {
        username: "This user name is already used by another tenant. Choose another one.",
        email: "This email address is already used by another tenant. Use another one.",
        subdomain: "This subdomain is already taken. Choose another one.",
        customDomain: "This domain is already used by another tenant.",
      },
    });
    expect(await tenantRow(id)).toStrictEqual(before);
    // Its own names stay usable (nothing changed, nothing refused).
    expect(await update(id, { username: before.admin_username.toUpperCase() })).toMatchObject({ ok: true, changed: [] });
  });

  it("is refused while setup runs, and for unknown tenants", async () => {
    const id = await createOk(manualInput("busy"));
    await setStatus(id, "provisioning");
    const result = await update(id, { fullName: "Test Busy Renamed" });
    expect(result).toStrictEqual({
      ok: false,
      reason: "invalid_state",
      message: "Wait until setup finishes before editing.",
    });
    await setStatus(id, "pending");

    const input = await editInput(id);
    expect(await updateTenantProfile(randomUUID(), input, actor())).toMatchObject({ ok: false, reason: "not_found" });
    expect(await updateTenantProfile("x", input, actor())).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("re-verifies a changed subdomain right away and keeps the slug", async () => {
    const id = await createOk(manualInput("subdomain"));
    const before = await tenantRow(id);
    const label = `test-moved-${randomLabel(6)}`;

    const result = await update(id, { subdomain: label.toUpperCase() });
    expect(result).toStrictEqual({ ok: true, tenantId: id, changed: ["subdomain"], dnsPending: false });
    expect((await tenantRow(id)).slug).toBe(before.slug);
    const row = await domainRow(id, "subdomain");
    expect(row).toMatchObject({ hostname: label, status: "active", last_check_error: null });
    expect(row?.verified_at).toBeInstanceOf(Date);
  });

  it.runIf(!LOCALHOST_BASE)("keeps a changed subdomain pending when it does not resolve", async () => {
    const id = await createOk(manualInput("nodns"));
    const label = `test-nodns-${randomLabel(6)}`;
    const result = await update(id, { subdomain: label }, fakeResolver({}, [`${label}.${BASE_DOMAIN}`]));
    expect(result).toMatchObject({ ok: true, changed: ["subdomain"], dnsPending: true });
    expect(await domainRow(id, "subdomain")).toMatchObject({ status: "pending", verified_at: null });
    expect((await domainRow(id, "subdomain"))?.last_check_error).toContain("does not resolve");
  });

  it("adds, verifies, changes and removes a custom domain", async () => {
    const id = await createOk(manualInput("custom"));
    const host = `music-${randomLabel(6)}.example.com`;

    // Add: pending with a fresh token.
    expect(await update(id, { customDomain: ` ${host.toUpperCase()}. ` })).toStrictEqual({
      ok: true,
      tenantId: id,
      changed: ["customDomain"],
      dnsPending: true,
    });
    const added = await domainRow(id, "custom");
    expect(added).toMatchObject({ hostname: host, status: "pending", verified_at: null });
    expect(added?.verification_token).toMatch(/^[0-9a-f]{32}$/);

    // Check DNS without the TXT record: stays pending, with the reason.
    const failed = await verifyCustomDomain(id, actor(), { dnsResolver: fakeResolver() });
    observed.push(failed);
    expect(failed).toMatchObject({ ok: false, reason: "dns" });
    expect(failed.ok ? "" : failed.message).toContain(`_md-verify.${host}`);
    const afterFailure = await domainRow(id, "custom");
    expect(afterFailure).toMatchObject({ status: "pending", verified_at: null });
    expect(afterFailure?.last_checked_at).toBeInstanceOf(Date);
    expect(afterFailure?.last_check_error).toContain("No TXT record");
    expect(afterFailure?.last_check_error?.length).toBeLessThanOrEqual(300);

    // With the record: active, verified, audited once.
    const resolver = fakeResolver({ [`_md-verify.${host}`]: [`md-verify=${added?.verification_token}`] });
    expect(await verifyCustomDomain(id, actor(), { dnsResolver: resolver })).toStrictEqual({ ok: true, status: "active" });
    const verified = await domainRow(id, "custom");
    expect(verified).toMatchObject({ status: "active", last_check_error: null });
    expect(verified?.verified_at).toBeInstanceOf(Date);
    expect(await verifyCustomDomain(id, actor(), { dnsResolver: resolver })).toStrictEqual({ ok: true, status: "active" });
    expect(await auditEvents(id, "tenant.domain_verified")).toStrictEqual([{ metadata: { domainType: "custom" } }]);

    // Change: the same row, a new host and token, pending again.
    const newHost = `music-${randomLabel(6)}.example.net`;
    expect(await update(id, { customDomain: newHost })).toMatchObject({ ok: true, changed: ["customDomain"], dnsPending: true });
    const changed = await domainRow(id, "custom");
    expect(changed).toMatchObject({
      id: added?.id,
      hostname: newHost,
      status: "pending",
      verified_at: null,
      last_checked_at: null,
      last_check_error: null,
    });
    expect(changed?.verification_token).not.toBe(added?.verification_token);

    // Remove: the row is gone, and there is nothing left to verify.
    expect(await update(id, { customDomain: "" })).toStrictEqual({
      ok: true,
      tenantId: id,
      changed: ["customDomain"],
      dnsPending: false,
    });
    expect(await domainRow(id, "custom")).toBeUndefined();
    expect(await verifyCustomDomain(id, actor(), { dnsResolver: resolver })).toMatchObject({
      ok: false,
      reason: "invalid_state",
    });
    expect(await verifyCustomDomain(randomUUID(), actor())).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("replaces and removes the profile image, deleting the old files", async () => {
    const id = await createOk(manualInput("photo", { profileImage: { bytes: PNG } }));
    const original = (await tenantRow(id)).profile_image_key ?? "";
    expect(await fileExists(original)).toBe(true);

    expect(await update(id, { profileImage: { action: "replace", bytes: JPEG } })).toMatchObject({
      ok: true,
      changed: ["profileImage"],
    });
    const replaced = (await tenantRow(id)).profile_image_key ?? "";
    expect(replaced).toMatch(new RegExp(`^tenants/${id}/profile/[0-9a-f-]{36}\\.jpg$`));
    expect(await fileExists(replaced)).toBe(true);
    expect(await fileExists(original)).toBe(false);

    expect(await update(id, { profileImage: { action: "remove" } })).toMatchObject({ ok: true, changed: ["profileImage"] });
    expect((await tenantRow(id)).profile_image_key).toBeNull();
    expect(await fileExists(replaced)).toBe(false);
    // Removing again is no change.
    expect(await update(id, { profileImage: { action: "remove" } })).toMatchObject({ ok: true, changed: [] });
  });

  it("deletes the new image when the change cannot be saved", async () => {
    const id = await createOk(manualInput("orphan", { profileImage: { bytes: PNG } }));
    const original = (await tenantRow(id)).profile_image_key ?? "";
    const spy = vi.spyOn(getControlDb(), "$transaction").mockRejectedValueOnce(new Error("simulated outage"));
    try {
      expect(await update(id, { profileImage: { action: "replace", bytes: JPEG } })).toMatchObject({
        ok: false,
        reason: "unavailable",
      });
    } finally {
      spy.mockRestore();
    }
    expect((await tenantRow(id)).profile_image_key).toBe(original);
    expect(await fileExists(original)).toBe(true);
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(path.join(storageRoot, "tenants", id, "profile"));
    expect(files).toStrictEqual([path.basename(original)]);
  });
});

// ---------------------------------------------------------------------------
// A provisioned tenant: its admin account exists in its own database.

let provisioned: { id: string; input: CreateTenantInput } | undefined;

function requireProvisioned(): { id: string; input: CreateTenantInput } {
  if (!provisioned) throw new Error("the provisioned tenant was not created");
  return provisioned;
}

describe("a provisioned tenant", () => {
  it("is set up to active (used by the tests below)", SLOW, async () => {
    const input = manualInput("prov");
    const id = await createOk(input);
    const outcome = await startProvisioning(id, actor(), { dnsResolver: fakeResolver() });
    expect(outcome).toMatchObject({ status: "succeeded" });
    expect((await getTenantForEdit(id))?.adminAccountExists).toBe(true);
    provisioned = { id, input };
  });

  it("syncs a changed user name and email into the tenant database", SLOW, async () => {
    const { id } = requireProvisioned();
    const before = await tenantRow(id);
    const username = `test-renamed-${randomLabel(6)}`;
    const email = `${username}@example.org`;

    const result = await update(id, { username, email: email.toUpperCase() });
    expect(result).toStrictEqual({ ok: true, tenantId: id, changed: ["username", "email"], dnsPending: false });
    expect(await tenantRow(id)).toMatchObject({ admin_username: username, contact_email: email });
    const rows = await adminRows(before.database_name);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ username, email });
    expect(await auditEvents(id, "tenant.updated")).toStrictEqual([{ metadata: { fields: ["username", "email"] } }]);
  });

  it("changes nothing when the tenant database refuses the new email", SLOW, async () => {
    const { id } = requireProvisioned();
    const before = await tenantRow(id);
    const taken = `customer-${randomLabel(6)}@example.org`;
    await resources.queryIn(
      before.database_name,
      "INSERT INTO users (id, email, name, updated_at) VALUES ($1, $2, 'A customer', now())",
      [randomUUID(), taken],
    );
    const rowsBefore = await adminRows(before.database_name);

    const result = await update(id, { email: taken, fullName: "Test Not Saved" });
    expect(result).toStrictEqual({
      ok: false,
      reason: "validation",
      fieldErrors: { email: "Another user in the tenant's database already has this email address." },
    });
    expect(await tenantRow(id)).toStrictEqual(before);
    expect(await adminRows(before.database_name)).toStrictEqual(rowsBefore);
  });

  it("reverts the tenant database when the control plane cannot be updated", SLOW, async () => {
    const { id } = requireProvisioned();
    const before = await tenantRow(id);
    const rowsBefore = await adminRows(before.database_name);
    const spy = vi.spyOn(getControlDb(), "$transaction").mockRejectedValueOnce(new Error("simulated outage"));
    try {
      const result = await update(id, { username: `test-lost-${randomLabel(6)}` });
      expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    } finally {
      spy.mockRestore();
    }
    expect(await tenantRow(id)).toStrictEqual(before);
    expect(await adminRows(before.database_name)).toStrictEqual(rowsBefore);
  });

  it("resets the master password: auto returns it once and stores only its Argon2id hash", SLOW, async () => {
    const { id } = requireProvisioned();
    const { database_name: database, admin_username: username } = await tenantRow(id);

    const result = await resetMasterPassword(id, { mode: "auto" }, actor());
    if (!result.ok) throw new Error(JSON.stringify(result));
    const password = result.generatedPassword ?? "";
    secrets.add(password);
    expect(password).toHaveLength(20);

    const admin = (await adminRows(database)).find((row) => row.username === username);
    const hash = admin?.password_hash ?? "";
    secrets.add(hash);
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, password)).toBe(true);
    expect((await tenantRow(id)).pending_admin_password_hash).toBeNull();
    expect(await auditEvents(id, "tenant.admin_password_reset")).toStrictEqual([{ metadata: { mode: "auto" } }]);
  });

  it("resets the master password manually, enforcing the policy", SLOW, async () => {
    const { id } = requireProvisioned();
    const { database_name: database, admin_username: username } = await tenantRow(id);
    for (const bad of ["short1A!", `Aa1!${username}xyz`, "alllowercaseletters"]) {
      secrets.add(bad);
      const result = await resetMasterPassword(id, { mode: "manual", password: bad }, actor());
      observed.push(result);
      expect(result, bad).toMatchObject({ ok: false, reason: "validation" });
    }
    const password = `Manual-${randomBytes(9).toString("base64url")}`;
    secrets.add(password);
    const result = await resetMasterPassword(id, { mode: "manual", password }, actor());
    observed.push(result);
    expect(result).toStrictEqual({ ok: true });
    const admin = (await adminRows(database)).find((row) => row.username === username);
    secrets.add(admin?.password_hash ?? "");
    expect(await verifyPassword(admin?.password_hash ?? "", password)).toBe(true);
  });

  it("rotates the database password: the old one stops working, the new one works", SLOW, async () => {
    const { id } = requireProvisioned();
    const row = await tenantRow(id);
    const login = { database: row.database_name, user: row.database_user, port: postgresPort() };
    const previous = await readSecret(row.database_secret_ref, "tenant_database_password");
    secrets.add(previous);

    const result = await rotateDatabasePassword(id, actor());
    observed.push(result);
    expect(result).toStrictEqual({ ok: true });

    const next = await readSecret(row.database_secret_ref, "tenant_database_password");
    secrets.add(next);
    expect(next).not.toBe(previous);
    expect(next).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await testDatabaseLogin({ ...login, password: previous })).toMatchObject({ ok: false, code: "auth_failed" });
    expect(await testDatabaseLogin({ ...login, password: next })).toStrictEqual({ ok: true });
    expect(await auditEvents(id, "tenant.database_password_rotated")).toHaveLength(1);
  });

  it("keeps the old password when the role cannot be altered", SLOW, async () => {
    const { id } = requireProvisioned();
    const row = await tenantRow(id);
    const previous = await readSecret(row.database_secret_ref, "tenant_database_password");
    // A stored role name that is not valid for the platform is never sent to PostgreSQL.
    await db.query("UPDATE tenants SET database_user = 'postgres' WHERE id = $1", [id]);
    try {
      expect(await rotateDatabasePassword(id, actor())).toMatchObject({ ok: false, reason: "unavailable" });
    } finally {
      await db.query("UPDATE tenants SET database_user = $2 WHERE id = $1", [id, row.database_user]);
    }
    expect(await readSecret(row.database_secret_ref, "tenant_database_password")).toBe(previous);
    expect(await auditEvents(id, "tenant.database_password_rotated")).toHaveLength(1);
  });

  it("refuses credential changes while setup runs", async () => {
    const { id } = requireProvisioned();
    await setStatus(id, "provisioning");
    try {
      expect(await resetMasterPassword(id, { mode: "auto" }, actor())).toMatchObject({ ok: false, reason: "invalid_state" });
      expect(await rotateDatabasePassword(id, actor())).toMatchObject({ ok: false, reason: "invalid_state" });
    } finally {
      await setStatus(id, "active");
    }
  });

  it("re-checks the subdomain, auditing only when it becomes active", async () => {
    const { id } = requireProvisioned();
    await db.query(
      "UPDATE tenant_domains SET status = 'pending', verified_at = NULL WHERE tenant_id = $1 AND type = 'subdomain'",
      [id],
    );
    const before = (await auditEvents(id, "tenant.domain_verified")).length;
    expect(await recheckSubdomain(id, actor(), { dnsResolver: fakeResolver() })).toStrictEqual({ ok: true, status: "active" });
    expect(await domainRow(id, "subdomain")).toMatchObject({ status: "active", last_check_error: null });
    expect(await recheckSubdomain(id, actor(), { dnsResolver: fakeResolver() })).toStrictEqual({ ok: true, status: "active" });
    const events = await auditEvents(id, "tenant.domain_verified");
    expect(events).toHaveLength(before + 1);
    expect(events.at(-1)).toStrictEqual({ metadata: { domainType: "subdomain" } });
  });

  it("does not take an existing-database password", async () => {
    const { id } = requireProvisioned();
    const password = `Existing-${randomBytes(9).toString("base64url")}`;
    secrets.add(password);
    expect(await updateExistingDatabasePassword(id, password, actor())).toMatchObject({
      ok: false,
      reason: "invalid_state",
    });
  });
});

describe("credentials of tenants without a provisioned login", () => {
  it("replaces the pending hash when setup failed before the admin existed", async () => {
    const tenant = await insertProvisioningTenant(db, { label: "nohash", status: "failed" });
    secrets.add(tenant.adminPassword);
    secrets.add(tenant.databasePassword);
    secrets.add(tenant.pendingHash);
    const password = `Pending-${randomBytes(9).toString("base64url")}`;
    secrets.add(password);

    const result = await resetMasterPassword(tenant.id, { mode: "manual", password }, actor());
    observed.push(result);
    expect(result).toStrictEqual({ ok: true });
    const hash = (await tenantRow(tenant.id)).pending_admin_password_hash ?? "";
    secrets.add(hash);
    expect(hash).not.toBe(tenant.pendingHash);
    expect(await verifyPassword(hash, password)).toBe(true);
    expect(await auditEvents(tenant.id, "tenant.admin_password_reset")).toStrictEqual([{ metadata: { mode: "manual" } }]);

    // Its database user was never created: there is nothing to rotate.
    expect(await rotateDatabasePassword(tenant.id, actor())).toMatchObject({ ok: false, reason: "invalid_state" });
  });

  it("refuses unknown tenants and unknown modes", async () => {
    expect(await resetMasterPassword(randomUUID(), { mode: "auto" }, actor())).toMatchObject({ reason: "not_found" });
    expect(await resetMasterPassword("x", { mode: "auto" }, actor())).toMatchObject({ reason: "not_found" });
    expect(
      await resetMasterPassword(randomUUID(), { mode: "other" } as unknown as { mode: "auto" }, actor()),
    ).toMatchObject({ reason: "validation" });
    expect(await rotateDatabasePassword(randomUUID(), actor())).toMatchObject({ reason: "not_found" });
  });

  it("are rate limited per owner and action (10 per 15 minutes)", async () => {
    const who = freshActor();
    const tenant = await insertProvisioningTenant(db, { label: "limit", status: "failed" });
    secrets.add(tenant.adminPassword);
    secrets.add(tenant.databasePassword);
    for (const prefix of ["tenant-admin-password", "tenant-db-rotate", "tenant-db-password"]) {
      await redis.set(`rl:${prefix}:${who.ownerId}`, "10", { EX: 60 });
    }
    expect(await resetMasterPassword(tenant.id, { mode: "auto" }, who)).toMatchObject({ reason: "rate_limited" });
    expect(await rotateDatabasePassword(tenant.id, who)).toMatchObject({ reason: "rate_limited" });
    expect(await updateExistingDatabasePassword(tenant.id, "whatever-password", who)).toMatchObject({
      reason: "rate_limited",
    });
    await redis.set(`rl:tenant-domain-check:${who.ownerId}`, "30", { EX: 60 });
    expect(await verifyCustomDomain(tenant.id, who)).toMatchObject({ reason: "rate_limited" });
    expect(await recheckSubdomain(tenant.id, who)).toMatchObject({ reason: "rate_limited" });
  });
});

describe("updateExistingDatabasePassword", () => {
  it("verifies the new password before saving it", SLOW, async () => {
    const names = testIdentifiers("existpw");
    const oldPassword = `Old-${randomBytes(12).toString("base64url")}`;
    const newPassword = `New-${randomBytes(12).toString("base64url")}`;
    secrets.add(oldPassword);
    secrets.add(newPassword);
    await resources.createDatabase(names.database);
    await resources.createRole(names.user, oldPassword);
    const tenant = await insertProvisioningTenant(db, {
      label: "existpw",
      mode: "existing",
      status: "active",
      database: names.database,
      user: names.user,
      databasePassword: oldPassword,
    });
    secrets.add(tenant.adminPassword);
    const secretRef = (await tenantRow(tenant.id)).database_secret_ref;

    // Not set on the server yet: refused, nothing saved.
    const refused = await updateExistingDatabasePassword(tenant.id, newPassword, actor());
    observed.push(refused);
    expect(refused).toMatchObject({ ok: false, reason: "validation" });
    expect(refused.ok ? "" : refused.message).toContain("was not saved");
    expect(await readSecret(secretRef, "tenant_database_password")).toBe(oldPassword);
    expect(await auditEvents(tenant.id, "tenant.database_password_updated")).toHaveLength(0);

    // The owner changes it on the server, then here.
    const admin = await connectTo("postgres");
    try {
      await admin.query(
        `ALTER ROLE ${escapeIdentifier(names.user)} PASSWORD ${escapeLiteral(scramSha256Verifier(newPassword))}`,
      );
    } finally {
      await admin.end();
    }
    const saved = await updateExistingDatabasePassword(tenant.id, newPassword, actor());
    observed.push(saved);
    expect(saved).toStrictEqual({ ok: true });
    expect(await readSecret(secretRef, "tenant_database_password")).toBe(newPassword);
    expect(await auditEvents(tenant.id, "tenant.database_password_updated")).toHaveLength(1);

    // An existing database's login is not the platform's to rotate.
    expect(await rotateDatabasePassword(tenant.id, actor())).toMatchObject({ ok: false, reason: "invalid_state" });
    expect(await updateExistingDatabasePassword(tenant.id, "", actor())).toMatchObject({ reason: "validation" });
  });
});

describe("secrets", () => {
  it("never appear in a result or the console", () => {
    const json = JSON.stringify(observed);
    for (const forbidden of ["passwordHash", "pendingAdminPasswordHash", "databaseSecretRef", "ciphertext"]) {
      expect(json).not.toContain(forbidden);
    }
    const log = consoleOutput.text();
    for (const secret of secrets) {
      if (!secret) continue;
      expect(json).not.toContain(secret);
      expect(log).not.toContain(secret);
    }
  });
});

describe("teardown", () => {
  it("drops every database and role this file created, and nothing else", SLOW, async () => {
    const dropped = await resources.cleanup();
    expect(dropped.databases.every((name) => name.startsWith("t_test_"))).toBe(true);
    expect(dropped.roles.every((name) => name.startsWith("t_test_"))).toBe(true);
    expect(await resources.inventory()).toStrictEqual(inventoryBefore);
  });
});

/**
 * The tenant service layer (src/lib/tenants/service) against the scratch
 * control database, the dev PostgreSQL server and Redis
 * (docs/tenant-management.md §8, §10).
 *
 * Tenant names start with "Test ", so every database and role provisioning
 * creates is named t_test_...; the last test drops exactly those and proves
 * the server's databases and roles are what they were before
 * (tests/support/tenant-resources.ts). Rate-limit counters are keyed by owner
 * id; this file deletes the keys of the ids it used.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Client } from "pg";
import { createClient } from "redis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/platform-auth/password";
import { latestTenantMigration } from "@/lib/provisioning";
import { readSecret } from "@/lib/secrets";
import { readProfileImage, storeProfileImage } from "@/lib/storage/profile-images";
import {
  createTenant,
  type CreateTenantInput,
  getTenantDetails,
  getTenantSummary,
  listTenants,
  previewGeneratedValues,
  reactivateTenant,
  retryProvisioning,
  startProvisioning,
  suspendTenant,
  type TenantActor,
  type TenantSummary,
  testDatabaseConnection,
} from "@/lib/tenants/service";
import { validateMasterPassword, validateNewDatabasePassword, validateTenantUsername } from "@/lib/tenants/rules";
import { closeAppDatabase, closeAppRedis } from "./support/app-connections";
import { captureConsole } from "./support/console";
import { clearTenantTables, connectToTestDatabase, insertOwner, insertTenant } from "./support/postgres";
import {
  insertProvisioningTenant,
  postgresPort,
  randomLabel,
  randomLetters,
  testTenantName,
  TenantResources,
  testIdentifiers,
} from "./support/tenant-resources";

const SLOW = { timeout: 90_000 };
const BASE_DOMAIN = process.env.PLATFORM_BASE_DOMAIN?.trim() || "localhost";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);

let db: Client;
let resources: TenantResources;
let redis: ReturnType<typeof createClient>;
let consoleOutput: { text: () => string };
let inventoryBefore: { databases: string[]; roles: string[] };
let storageRoot: string;
let ownerId: string;
const ownerUsername = `vt-owner-${randomLabel(8)}`;

// Owner ids whose rate-limit counters this file created.
const usedOwnerIds = new Set<string>();
// Every secret value the tests know of: none may appear in a DTO or the log.
const secrets = new Set<string>();
// DTOs returned by the read services, checked for secrets at the end.
const observed: unknown[] = [];

function actor(id: string = ownerId): TenantActor {
  usedOwnerIds.add(id);
  return { ownerId: id, ipAddress: "203.0.113.9" };
}

/** An owner of its own, with fresh rate-limit budgets. */
function freshActor(): TenantActor {
  return actor(randomUUID());
}

beforeAll(async () => {
  // src/lib/env.ts reads the environment on first use, which is after this.
  storageRoot = await mkdtemp(path.join(os.tmpdir(), "vt-tenant-storage-"));
  process.env.STORAGE_ROOT = storageRoot;

  db = await connectToTestDatabase();
  await clearTenantTables(db);
  resources = await TenantResources.open(db);
  inventoryBefore = await resources.inventory();
  ownerId = await insertOwner(db, {
    username: ownerUsername,
    passwordHash: await hashPassword(randomBytes(16).toString("base64url")),
  });

  const host = process.env.REDIS_HOST?.trim();
  const password = process.env.REDIS_PASSWORD?.trim();
  redis = createClient({
    socket: { host, port: Number(process.env.REDIS_PORT?.trim() || "6379"), connectTimeout: 5_000 },
    password,
  });
  redis.on("error", () => undefined);
  await redis.connect();

  consoleOutput = captureConsole();
  for (const name of ["POSTGRES_PASSWORD", "TENANT_SECRETS_KEY", "REDIS_PASSWORD"]) {
    const value = process.env[name];
    if (value) secrets.add(value);
  }
});

// Each test starts with the shared owner's budgets reset.
afterEach(async () => {
  for (const id of usedOwnerIds) {
    for (const prefix of ["tenant-create", "tenant-preview", "tenant-retry", "tenant-db-test"]) {
      await redis.del(`rl:${prefix}:${id}`);
    }
  }
});

afterAll(async () => {
  vi.restoreAllMocks();
  // Normally a no-op: the last test already cleaned up. Runs again if it failed early.
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

/** A valid manual-mode, new-database form for a tenant named "Test <label> <random>". */
function manualInput(label: string, overrides: Partial<CreateTenantInput> = {}): CreateTenantInput {
  const token = randomLabel(6);
  const names = testIdentifiers(label);
  const input: CreateTenantInput = {
    fullName: testTenantName(label),
    phone: "9876543210",
    username: `test-${label}-${token}`.replaceAll("_", "-"),
    email: `test-${label}-${token}@example.com`.replaceAll("_", "-"),
    masterPassword: `Mp-${randomBytes(12).toString("base64url")}`,
    databaseName: names.database,
    databaseUser: names.user,
    databasePassword: randomBytes(24).toString("base64url"),
    databasePort: "",
    subdomain: `test-${label}-${token}`.replaceAll("_", "-"),
    customDomain: "",
    loginMode: "manual",
    databaseCredentialMode: "manual",
    subdomainMode: "manual",
    databaseMode: "provisioned",
    profileImage: null,
    ...overrides,
  };
  secrets.add(input.masterPassword);
  secrets.add(input.databasePassword);
  return input;
}

async function createOk(input: CreateTenantInput, who: TenantActor = actor()): Promise<string> {
  const result = await createTenant(input, who);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result)}`);
  return result.tenantId;
}

type TenantRow = {
  status: string;
  status_reason: string | null;
  suspended_at: Date | null;
  slug: string;
  phone: string | null;
  database_mode: string;
  database_name: string;
  database_user: string;
  database_port: number;
  database_secret_ref: string;
  pending_admin_password_hash: string | null;
  profile_image_key: string | null;
};

async function tenantRow(id: string): Promise<TenantRow | undefined> {
  const result = await db.query<TenantRow>(
    `SELECT status, status_reason, suspended_at, slug, phone, database_mode, database_name, database_user,
            database_port, database_secret_ref, pending_admin_password_hash, profile_image_key
     FROM tenants WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

async function tenantCount(): Promise<number> {
  return Number((await db.query<{ n: string }>("SELECT count(*) AS n FROM tenants")).rows[0]?.n);
}

async function setStatus(id: string, status: string): Promise<void> {
  await db.query("UPDATE tenants SET status = $2::tenant_status WHERE id = $1", [id, status]);
}

async function storedFiles(): Promise<string[]> {
  try {
    return (await readdir(storageRoot, { recursive: true })).filter((name) =>
      /\.(png|jpg|webp)$/.test(name),
    );
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------

describe("getTenantSummary", () => {
  it("counts zero when there are no tenants", async () => {
    const summary = await getTenantSummary();
    observed.push(summary);
    expect(summary).toStrictEqual<TenantSummary>({
      total: 0,
      active: 0,
      suspended: 0,
      pendingSetup: 0,
      failed: 0,
    });
  });
});

describe("previewGeneratedValues", () => {
  it("proposes valid values derived from the name, with the default port and base domain", async () => {
    const result = await previewGeneratedValues(`Test Preview ${randomLabel(6)}`, freshActor());
    if (!result.ok) throw new Error(JSON.stringify(result));
    const { values } = result;
    expect(validateTenantUsername(values.username).ok).toBe(true);
    expect(values.username).toMatch(/^test-preview-[a-z0-9]{6}$/);
    expect(values.subdomain).toBe(values.username);
    expect(values.databaseName).toMatch(/^t_test_preview_[a-z0-9]{6}_[a-z0-9]{6}$/);
    expect(values.databaseUser).toBe(`${values.databaseName}_app`);
    expect(values.port).toBe(postgresPort());
    expect(values.baseDomain).toBe(BASE_DOMAIN);
    expect(JSON.stringify(result)).not.toMatch(/password/i);
  });

  it("still proposes values for an empty name", async () => {
    const result = await previewGeneratedValues("", freshActor());
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.values.username).toMatch(/^tenant/);
  });

  it("is rate limited per owner (60 per 5 minutes)", async () => {
    const who = freshActor();
    await redis.set(`rl:tenant-preview:${who.ownerId}`, "60", { EX: 60 });
    const result = await previewGeneratedValues("Test Limited", who);
    expect(result).toMatchObject({ ok: false, reason: "rate_limited" });
  });
});

let autoTenant: { id: string; password: string; customDomain: string; fullName: string } | undefined;

describe("createTenant", () => {
  it("creates an auto-mode tenant from previewed values, which then provisions to active", SLOW, async () => {
    const fullName = `Test Auto ${randomLetters(6)}`;
    const preview = await previewGeneratedValues(fullName, actor());
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    const customDomain = `music-${randomLabel(6)}.example.com`;
    const email = `auto-${randomLabel(6)}@example.com`;

    const result = await createTenant(
      {
        fullName,
        phone: "",
        username: preview.values.username,
        email,
        // Whatever arrives for these in auto mode is ignored.
        masterPassword: "ignored-master",
        databaseName: preview.values.databaseName,
        databaseUser: preview.values.databaseUser,
        databasePassword: "ignored-database",
        databasePort: "1",
        subdomain: preview.values.subdomain,
        customDomain: ` ${customDomain.toUpperCase()}. `,
        loginMode: "auto",
        databaseCredentialMode: "auto",
        subdomainMode: "auto",
        databaseMode: "provisioned",
        profileImage: null,
      },
      actor(),
    );
    if (!result.ok) throw new Error(JSON.stringify(result));
    const password = result.generatedMasterPassword ?? "";
    secrets.add(password);
    expect(password).toHaveLength(20);
    expect(validateMasterPassword(password, preview.values.username).ok).toBe(true);
    autoTenant = { id: result.tenantId, password, customDomain, fullName };

    const row = await tenantRow(result.tenantId);
    if (!row) throw new Error("no tenant row");
    expect(row).toMatchObject({
      status: "pending",
      slug: preview.values.subdomain,
      phone: null,
      database_mode: "provisioned",
      database_name: preview.values.databaseName,
      database_user: preview.values.databaseUser,
      database_port: postgresPort(),
      profile_image_key: null,
    });
    // Only the Argon2id hash of the master password is kept.
    const hash = row.pending_admin_password_hash ?? "";
    secrets.add(hash);
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, password)).toBe(true);
    expect(JSON.stringify(row)).not.toContain(password);

    // The database password is generated, encrypted, and not what was submitted.
    secrets.add(row.database_secret_ref);
    const databasePassword = await readSecret(row.database_secret_ref, "tenant_database_password");
    secrets.add(databasePassword);
    expect(databasePassword).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const secretRow = await db.query<{ ciphertext: Buffer }>(
      "SELECT ciphertext FROM secrets WHERE id = $1",
      [row.database_secret_ref],
    );
    expect(secretRow.rows[0]?.ciphertext.toString("utf8")).not.toContain(databasePassword);
    secrets.add(secretRow.rows[0]?.ciphertext.toString("hex") ?? "");

    const domains = await db.query<{ type: string; hostname: string; status: string; verification_token: string | null }>(
      "SELECT type::text, hostname, status::text, verification_token FROM tenant_domains WHERE tenant_id = $1 ORDER BY 1 DESC",
      [result.tenantId],
    );
    expect(domains.rows).toMatchObject([
      { type: "subdomain", hostname: preview.values.subdomain, status: "pending", verification_token: null },
      { type: "custom", hostname: customDomain, status: "pending" },
    ]);
    expect(domains.rows[1]?.verification_token).toMatch(/^[0-9a-f]{32}$/);

    const audit = await db.query<{ action: string; actor_type: string; actor_id: string; ip: string; metadata: unknown }>(
      `SELECT action, actor_type::text, actor_id, host(ip_address) AS ip, metadata
       FROM audit_events WHERE tenant_id = $1 AND action = 'tenant.created'`,
      [result.tenantId],
    );
    expect(audit.rows).toStrictEqual([
      {
        action: "tenant.created",
        actor_type: "super_admin",
        actor_id: ownerId,
        ip: "203.0.113.9",
        metadata: {
          loginMode: "auto",
          databaseCredentialMode: "auto",
          subdomainMode: "auto",
          databaseMode: "provisioned",
          hasCustomDomain: true,
        },
      },
    ]);

    // The previewed names are now taken: a new preview proposes others.
    const again = await previewGeneratedValues(fullName, actor());
    if (!again.ok) throw new Error(JSON.stringify(again));
    expect(again.values.username).not.toBe(preview.values.username);
    expect(again.values.subdomain).not.toBe(preview.values.subdomain);
    expect(again.values.databaseName).not.toBe(preview.values.databaseName);

    const outcome = await startProvisioning(result.tenantId, actor());
    expect(outcome).toStrictEqual({ status: "succeeded" });
    expect((await tenantRow(result.tenantId))?.status).toBe("active");
    expect((await tenantRow(result.tenantId))?.pending_admin_password_hash).toBeNull();
  });

  it("creates a manual-mode tenant with the submitted values and returns no password", async () => {
    const input = manualInput("manual", { databasePort: String(postgresPort()) });
    const result = await createTenant(input, actor());
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(Object.keys(result).sort()).toStrictEqual(["ok", "tenantId"]);

    const row = await tenantRow(result.tenantId);
    expect(row).toMatchObject({
      status: "pending",
      phone: "9876543210",
      database_name: input.databaseName,
      database_user: input.databaseUser,
      database_port: postgresPort(),
    });
    expect(await verifyPassword(row?.pending_admin_password_hash ?? "", input.masterPassword)).toBe(true);
    expect(await readSecret(row?.database_secret_ref ?? "", "tenant_database_password")).toBe(
      input.databasePassword,
    );
    secrets.add(row?.pending_admin_password_hash ?? "");
  });

  it("reports every required field at once", async () => {
    const before = await tenantCount();
    const empty: CreateTenantInput = {
      fullName: "",
      phone: "",
      username: "",
      email: "",
      masterPassword: "",
      databaseName: "",
      databaseUser: "",
      databasePassword: "",
      databasePort: "",
      subdomain: "",
      customDomain: "",
      loginMode: "manual",
      databaseCredentialMode: "manual",
      subdomainMode: "manual",
      databaseMode: "provisioned",
      profileImage: null,
    };
    const result = await createTenant(empty, actor());
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "validation") throw new Error(JSON.stringify(result));
    expect(Object.keys(result.fieldErrors).sort()).toStrictEqual(
      [
        "databaseName",
        "databasePassword",
        "databaseUser",
        "email",
        "fullName",
        "masterPassword",
        "subdomain",
        "username",
      ].sort(),
    );
    expect(await tenantCount()).toBe(before);
  });

  it("rejects unknown modes and invalid optional fields", async () => {
    const result = await createTenant(
      manualInput("modes", {
        loginMode: "sometimes",
        databaseCredentialMode: "sometimes",
        subdomainMode: "sometimes",
        databaseMode: "borrowed",
        phone: "12",
        databasePort: "70000",
        customDomain: "shop.localhost",
      }),
      actor(),
    );
    if (result.ok || result.reason !== "validation") throw new Error(JSON.stringify(result));
    expect(Object.keys(result.fieldErrors).sort()).toStrictEqual(
      ["loginMode", "databaseCredentialMode", "subdomainMode", "customDomain", "databaseMode", "phone"].sort(),
    );
  });

  it("rejects an existing database with the Database section on Auto", async () => {
    const result = await createTenant(
      manualInput("autoexisting", { databaseCredentialMode: "auto", databaseMode: "existing" }),
      actor(),
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "validation",
      fieldErrors: { databaseMode: "Switch the Database section to Manual to attach an existing database." },
    });
  });

  it("mixes section modes: generated master password, typed database credentials", async () => {
    const input = manualInput("mixlogin", {
      loginMode: "auto",
      // Ignored: the login section is on Auto, so the server generates the password.
      masterPassword: "ignored-master",
      databasePort: String(postgresPort()),
    });
    const result = await createTenant(input, actor());
    if (!result.ok) throw new Error(JSON.stringify(result));
    const password = result.generatedMasterPassword ?? "";
    secrets.add(password);
    expect(validateMasterPassword(password, input.username).ok).toBe(true);

    const row = await tenantRow(result.tenantId);
    expect(row).toMatchObject({ database_name: input.databaseName, database_port: postgresPort() });
    expect(await verifyPassword(row?.pending_admin_password_hash ?? "", password)).toBe(true);
    expect(await readSecret(row?.database_secret_ref ?? "", "tenant_database_password")).toBe(
      input.databasePassword,
    );
    secrets.add(row?.pending_admin_password_hash ?? "");
  });

  it("mixes section modes: typed master password, generated database secrets, no password returned", async () => {
    const input = manualInput("mixdb", {
      databaseCredentialMode: "auto",
      // Ignored: the database section is on Auto, so the password and port are generated.
      databasePassword: "ignored-database",
      databasePort: "1",
    });
    const result = await createTenant(input, actor());
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(Object.keys(result).sort()).toStrictEqual(["ok", "tenantId"]);

    const row = await tenantRow(result.tenantId);
    expect(row).toMatchObject({ database_port: postgresPort() });
    expect(await verifyPassword(row?.pending_admin_password_hash ?? "", input.masterPassword)).toBe(true);
    const stored = await readSecret(row?.database_secret_ref ?? "", "tenant_database_password");
    secrets.add(stored);
    expect(stored).not.toBe("ignored-database");
    expect(validateNewDatabasePassword(stored).ok).toBe(true);
    secrets.add(row?.pending_admin_password_hash ?? "");
  });

  it("rejects a manual port no PostgreSQL server answers on", async () => {
    const result = await createTenant(manualInput("noport", { databasePort: "1" }), actor());
    expect(result).toMatchObject({ ok: false, reason: "validation" });
    if (result.ok || result.reason !== "validation") return;
    expect(Object.keys(result.fieldErrors)).toStrictEqual(["databasePort"]);
  });

  it("is rate limited per owner (20 per hour), before anything else", async () => {
    const who = freshActor();
    const reasons: string[] = [];
    for (let i = 0; i < 21; i += 1) {
      const result = await createTenant(manualInput("limit", { fullName: "" }), who);
      reasons.push(result.ok ? "ok" : result.reason);
    }
    expect(reasons.slice(0, 20).every((reason) => reason === "validation")).toBe(true);
    expect(reasons[20]).toBe("rate_limited");
  });
});

describe("createTenant: names already taken", () => {
  let existing: CreateTenantInput;

  beforeAll(async () => {
    existing = manualInput("taken", { customDomain: `taken-${randomLabel(6)}.example.net` });
    await createOk(existing);
  });

  it.each(["username", "email", "subdomain", "customDomain", "databaseName", "databaseUser"] as const)("refuses a duplicate %s", async (field) => {
    const before = await tenantCount();
    const result = await createTenant(manualInput("dupe", { [field]: existing[field] }), actor());
    if (result.ok || result.reason !== "validation") throw new Error(JSON.stringify(result));
    expect(Object.keys(result.fieldErrors)).toStrictEqual([field]);
    expect(await tenantCount()).toBe(before);
  });

  it("matches names case-insensitively where the rules normalize them", async () => {
    const result = await createTenant(
      manualInput("dupecase", {
        email: existing.email.toUpperCase(),
        username: existing.username.toUpperCase(),
        subdomain: existing.subdomain.toUpperCase(),
      }),
      actor(),
    );
    if (result.ok || result.reason !== "validation") throw new Error(JSON.stringify(result));
    expect(Object.keys(result.fieldErrors).sort()).toStrictEqual(["email", "subdomain", "username"]);
  });

  it("refuses a database or role that already exists on the server", async () => {
    const names = testIdentifiers("onserver");
    await resources.createDatabase(names.database);
    await resources.createRole(names.user, randomBytes(18).toString("base64url"));
    const result = await createTenant(
      manualInput("onserver", { databaseName: names.database, databaseUser: names.user }),
      actor(),
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "validation",
      fieldErrors: {
        databaseName: "A database with this name already exists on the server. Choose another name.",
        databaseUser: "A role with this name already exists on the server. Choose another name.",
      },
    });
  });

  it("tells the owner to regenerate when a previewed value was taken meanwhile", async () => {
    const input = manualInput("regen", {
      username: existing.username,
      subdomain: existing.subdomain,
      loginMode: "auto",
    });
    const result = await createTenant(input, actor());
    expect(result).toMatchObject({
      ok: false,
      reason: "validation",
      fieldErrors: {
        // The login section is on Auto: its username was previewed.
        username: `${existing.username} is no longer available — regenerate.`,
        // The domain section is on Manual: the owner typed the subdomain.
        subdomain: "This subdomain is already taken. Choose another one.",
      },
    });
  });

  it.each(["email", "subdomain", "customDomain", "databaseName"] as const)(
    "maps a unique violation at insert time (a race) on %s to that field and removes the stored image",
    async (field) => {
      const before = await tenantCount();
      const filesBefore = await storedFiles();
      const result = await createTenant(
        manualInput("race", { [field]: existing[field], profileImage: { bytes: PNG } }),
        actor(),
        // As if another create had committed between the check and the insert.
        { takenInControlPlane: async () => new Set() },
      );
      if (result.ok || result.reason !== "validation") throw new Error(JSON.stringify(result));
      expect(Object.keys(result.fieldErrors)).toStrictEqual([field]);
      expect(await tenantCount()).toBe(before);
      expect(await storedFiles()).toStrictEqual(filesBefore);
    },
  );
});

describe("createTenant: existing database", () => {
  let names: { database: string; user: string };
  const rolePassword = `Ex-${randomBytes(18).toString("base64url")}`;

  beforeAll(async () => {
    secrets.add(rolePassword);
    names = testIdentifiers("existing");
    await resources.createDatabase(names.database);
    await resources.createRole(names.user, rolePassword);
  });

  it("rejects a wrong password with the list of checks", SLOW, async () => {
    const before = await tenantCount();
    const wrong = `Wrong-${randomBytes(12).toString("base64url")}`;
    secrets.add(wrong);
    const result = await createTenant(
      manualInput("existing", {
        databaseMode: "existing",
        databaseName: names.database,
        databaseUser: names.user,
        databasePassword: wrong,
      }),
      actor(),
    );
    if (result.ok || result.reason !== "validation") throw new Error(JSON.stringify(result));
    expect(result.fieldErrors).toStrictEqual({});
    const checks = result.checks ?? [];
    expect(checks.length).toBeGreaterThan(1);
    expect(checks.some((check) => check.status === "fail")).toBe(true);
    for (const check of checks) {
      expect(Object.keys(check).sort()).toStrictEqual(["id", "label", "message", "status"]);
    }
    expect(await tenantCount()).toBe(before);
  });

  it("tests the connection without saving anything", SLOW, async () => {
    const who = freshActor();
    const before = await tenantCount();
    const good = await testDatabaseConnection(
      { databaseName: names.database, databaseUser: names.user, databasePassword: rolePassword, databasePort: "" },
      who,
    );
    expect(good).toMatchObject({ kind: "checked", ok: true });
    const bad = await testDatabaseConnection(
      { databaseName: names.database, databaseUser: names.user, databasePassword: "nope", databasePort: "" },
      who,
    );
    expect(bad).toMatchObject({ kind: "checked", ok: false });
    const invalid = await testDatabaseConnection(
      { databaseName: "Bad Name", databaseUser: "postgres", databasePassword: "", databasePort: "x" },
      who,
    );
    expect(invalid.kind).toBe("invalid");
    if (invalid.kind === "invalid") {
      expect(Object.keys(invalid.fieldErrors).sort()).toStrictEqual(
        ["databaseName", "databasePassword", "databasePort", "databaseUser"].sort(),
      );
    }
    expect(await tenantCount()).toBe(before);
    observed.push(good, bad, invalid);
  });

  it("accepts the right password", SLOW, async () => {
    const input = manualInput("existing", {
      databaseMode: "existing",
      databaseName: names.database,
      databaseUser: names.user,
      databasePassword: rolePassword,
    });
    const id = await createOk(input);
    expect(await tenantRow(id)).toMatchObject({ database_mode: "existing", database_name: names.database });
  });
});

describe("profile images", () => {
  it("stores a valid image with the tenant and reads it back", async () => {
    const id = await createOk(manualInput("image", { profileImage: { bytes: PNG } }));
    const row = await tenantRow(id);
    expect(row?.profile_image_key).toMatch(new RegExp(`^tenants/${id}/profile/[0-9a-f-]{36}\\.png$`));
    const image = await readProfileImage(id);
    expect(image?.contentType).toBe("image/png");
    expect(Buffer.from(image?.bytes ?? new Uint8Array())).toStrictEqual(Buffer.from(PNG));
    expect((await getTenantDetails(id))?.hasProfileImage).toBe(true);
  });

  it("rejects bytes that are not a PNG, JPEG or WebP image", async () => {
    const before = await tenantCount();
    const filesBefore = await storedFiles();
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    const result = await createTenant(manualInput("badimage", { profileImage: { bytes: svg } }), actor());
    expect(result).toMatchObject({
      ok: false,
      reason: "validation",
      fieldErrors: { profileImage: "Use a PNG, JPEG or WebP image." },
    });
    expect(await tenantCount()).toBe(before);
    expect(await storedFiles()).toStrictEqual(filesBefore);
    expect(await storeProfileImage(randomUUID(), svg)).toMatchObject({ ok: false });
  });

  it("reads nothing for a tenant without an image or an invalid id", async () => {
    const id = await createOk(manualInput("noimage"));
    expect(await readProfileImage(id)).toBeNull();
    expect(await readProfileImage(randomUUID())).toBeNull();
    expect(await readProfileImage("../../etc/passwd")).toBeNull();
  });
});

describe("listTenants", () => {
  // Letters only: the token is part of tenant full names, which allow no digits.
  const token = randomLetters(6);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const make = async (key: string, fullName: string, extra: Partial<CreateTenantInput> = {}) => {
      ids[key] = await createOk(
        manualInput("list", { fullName, ...extra }),
      );
    };
    await make("alpha", `Test Listing ${token} Alpha`, {
      username: `test-la-${token}`,
      email: `alpha-${token}@example.com`,
      subdomain: `acme-${token}`,
      customDomain: `alpha-${token}.example.org`,
    });
    // Names cannot hold % or _ any more (letters only), so the literal-match
    // cases use the email address, which the search covers too.
    await make("percent", `Test Percent ${token}`, { email: `pct-100%-${token}@example.com` });
    await make("percentX", `Test Percentx ${token}`, { email: `pct-100x-${token}@example.com` });
    await make("underscore", `Test Underscore ${token}`, { email: `us-a_b-${token}@example.com` });
    await make("underscoreX", `Test Underscorex ${token}`, { email: `us-axb-${token}@example.com` });
    await setStatus(ids.alpha as string, "active");
    await setStatus(ids.percent as string, "suspended");
    await setStatus(ids.percentX as string, "failed");
    await setStatus(ids.underscore as string, "provisioning");
  });

  async function search(q: string, status: "all" | "active" | "suspended" | "pending" | "failed" = "all") {
    const page = await listTenants({ q, status, page: 1 });
    observed.push(page);
    return page.rows.map((row) => row.id).sort();
  }

  it("finds tenants by name, user name, email, subdomain host and custom domain", async () => {
    expect(await search(`listing ${token}`.toUpperCase())).toStrictEqual([ids.alpha]);
    expect(await search(`test-la-${token}`)).toStrictEqual([ids.alpha]);
    expect(await search(`alpha-${token}@`)).toStrictEqual([ids.alpha]);
    expect(await search(`acme-${token}`)).toStrictEqual([ids.alpha]);
    expect(await search(`acme-${token}.${BASE_DOMAIN}`)).toStrictEqual([ids.alpha]);
    expect(await search(`alpha-${token}.example.org`)).toStrictEqual([ids.alpha]);
    expect(await search(token)).toHaveLength(5);
  });

  it("matches % and _ literally", async () => {
    expect(await search(`100%-${token}`)).toStrictEqual([ids.percent]);
    expect(await search(`a_b-${token}`)).toStrictEqual([ids.underscore]);
    expect(await search(`${token}%`)).toStrictEqual([]);
  });

  it("filters by status (pending = pending + provisioning)", async () => {
    expect(await search(token, "active")).toStrictEqual([ids.alpha]);
    expect(await search(token, "suspended")).toStrictEqual([ids.percent]);
    expect(await search(token, "failed")).toStrictEqual([ids.percentX]);
    expect(await search(token, "pending")).toStrictEqual([ids.underscore, ids.underscoreX].sort());
  });

  it("returns rows with exactly the documented fields", async () => {
    const page = await listTenants({ q: `test-la-${token}`, status: "all", page: 1 });
    const row = page.rows[0];
    expect(row).toStrictEqual({
      id: ids.alpha,
      name: `Test Listing ${token} Alpha`,
      username: `test-la-${token}`,
      email: `alpha-${token}@example.com`,
      phone: "9876543210",
      status: "active",
      statusReason: null,
      subdomainHost: `acme-${token}.${BASE_DOMAIN}`,
      customDomain: { host: `alpha-${token}.example.org`, status: "pending" },
      databaseMode: "provisioned",
      databaseState: "ready",
      hasProfileImage: false,
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    const states = await listTenants({ q: token, status: "all", page: 1 });
    const byId = new Map(states.rows.map((r) => [r.id, r.databaseState]));
    expect(byId.get(ids.percent as string)).toBe("ready");
    expect(byId.get(ids.percentX as string)).toBe("failed");
    expect(byId.get(ids.underscore as string)).toBe("provisioning");
    expect(byId.get(ids.underscoreX as string)).toBe("pending");
  });

  it("pages 20 rows at a time, newest first, and falls back to page 1 for invalid pages", async () => {
    const prefix = `test-page-${token}`;
    for (let i = 0; i < 22; i += 1) {
      await insertTenant(db, { slug: `${prefix}-${String(i).padStart(2, "0")}` });
    }
    const first = await listTenants({ q: prefix, status: "all", page: 1 });
    expect(first).toMatchObject({ total: 22, page: 1, pageCount: 2, pageSize: 20 });
    expect(first.rows).toHaveLength(20);
    const second = await listTenants({ q: prefix, status: "all", page: 2 });
    expect(second.rows).toHaveLength(2);
    const all = [...first.rows, ...second.rows];
    expect(new Set(all.map((row) => row.id)).size).toBe(22);
    const order = all.map((row) => `${row.createdAt}|${row.id}`);
    expect(order).toStrictEqual([...order].sort().reverse());

    expect((await listTenants({ q: prefix, status: "all", page: 3 })).rows).toHaveLength(0);
    for (const page of [0, -1, 10_001, Number.NaN, 1.5]) {
      const result = await listTenants({ q: prefix, status: "all", page });
      expect(result.page).toBe(1);
      expect(result.rows).toHaveLength(20);
    }
    const none = await listTenants({ q: `${prefix}-nothing`, status: "all", page: 1 });
    expect(none).toMatchObject({ rows: [], total: 0, pageCount: 1 });
    // An invalid status filter or an over-long query never errors.
    const loose = await listTenants({ q: `${prefix}${"x".repeat(500)}`, status: "bogus" as "all", page: 1 });
    expect(loose.total).toBe(0);
  });
});

describe("getTenantSummary with tenants", () => {
  it("counts each status from the database", async () => {
    const before = await getTenantSummary();
    const tenant = (status: "pending" | "provisioning" | "failed" | "active" | "suspended") =>
      insertProvisioningTenant(db, { label: "summary", status });
    await tenant("active");
    await tenant("suspended");
    await tenant("failed");
    await tenant("provisioning");
    await tenant("pending");
    const after = await getTenantSummary();
    observed.push(after);
    expect(after).toStrictEqual({
      total: before.total + 5,
      active: before.active + 1,
      suspended: before.suspended + 1,
      pendingSetup: before.pendingSetup + 3,
      failed: before.failed + 1,
    });
    const grouped = await db.query<{ n: string }>("SELECT count(*) AS n FROM tenants");
    expect(after.total).toBe(Number(grouped.rows[0]?.n));
  });
});

describe("getTenantDetails", () => {
  it("describes a provisioned tenant completely", async () => {
    if (!autoTenant) throw new Error("the auto-mode tenant was not created");
    const details = await getTenantDetails(autoTenant.id);
    observed.push(details);
    if (!details) throw new Error("no details");
    const row = await tenantRow(autoTenant.id);

    expect(details).toMatchObject({
      id: autoTenant.id,
      name: autoTenant.fullName,
      status: "active",
      statusReason: null,
      hasProfileImage: false,
      suspendedAt: null,
      profile: { name: autoTenant.fullName, phone: null },
      login: { username: row?.slug, twoFactor: "unavailable" },
      database: {
        mode: "provisioned",
        name: row?.database_name,
        user: row?.database_user,
        port: postgresPort(),
        host: process.env.POSTGRES_HOST,
        hasPassword: true,
        schemaStatus: "current",
        schemaVersion: await latestTenantMigration(),
      },
      domains: {
        baseDomain: BASE_DOMAIN,
        subdomain: { label: row?.slug, host: `${row?.slug}.${BASE_DOMAIN}`, status: "active" },
        custom: {
          host: autoTenant.customDomain,
          status: "pending",
          verification: {
            name: `_md-verify.${autoTenant.customDomain}`,
            value: expect.stringMatching(/^md-verify=[0-9a-f]{32}$/),
          },
        },
      },
      provisioning: { attempt: 1, lastError: null, canRetry: false },
      suspension: null,
    });
    expect(details.activatedAt).toMatch(/^\d{4}-/);
    expect(details.provisioning.steps.map((step) => [step.step, step.state])).toStrictEqual([
      ["create_database_user", "done"],
      ["create_database", "done"],
      ["grant_privileges", "done"],
      ["apply_migrations", "done"],
      ["create_initial_admin", "done"],
      ["register_domain", "done"],
      ["verify", "done"],
    ]);
    expect(details.provisioning.steps[3]?.label).toBe("Install schema");
    expect(details.history.map((entry) => [entry.action, entry.actor])).toStrictEqual([
      // The runner records the outcome of a run as the system's.
      ["tenant.provisioned", "System"],
      ["tenant.created", ownerUsername],
    ]);
  });

  it("shows a failed run: done, failed and waiting steps, the safe error and a retry", async () => {
    const tenant = await insertProvisioningTenant(db, { label: "detailfail", status: "failed" });
    secrets.add(tenant.databasePassword);
    secrets.add(tenant.adminPassword);
    secrets.add(tenant.pendingHash);
    const runId = randomUUID();
    await db.query(
      `INSERT INTO tenant_provisioning_runs (id, tenant_id, attempt, status, step, error_code, error_message, finished_at)
       VALUES ($1, $2, 2, 'failed', 'create_database', 'resource_conflict', 'The database exists.', now())`,
      [runId, tenant.id],
    );
    await db.query(
      "INSERT INTO tenant_provisioning_steps (tenant_id, step, run_id) VALUES ($1, 'create_database_user', $2)",
      [tenant.id, runId],
    );
    const details = await getTenantDetails(tenant.id);
    observed.push(details);
    expect(details?.provisioning).toStrictEqual({
      steps: [
        { step: "create_database_user", label: "Create database user", state: "done" },
        { step: "create_database", label: "Create database", state: "failed" },
        { step: "grant_privileges", label: "Grant privileges", state: "waiting" },
        { step: "apply_migrations", label: "Install schema", state: "waiting" },
        { step: "create_initial_admin", label: "Create admin account", state: "waiting" },
        { step: "register_domain", label: "Register domain", state: "waiting" },
        { step: "verify", label: "Verify", state: "waiting" },
      ],
      attempt: 2,
      lastError: { code: "resource_conflict", message: "The database exists." },
      canRetry: true,
    });
  });

  it("is null for an unknown or malformed id", async () => {
    expect(await getTenantDetails(randomUUID())).toBeNull();
    expect(await getTenantDetails("not-a-uuid")).toBeNull();
    expect(await getTenantDetails("' OR 1=1 --")).toBeNull();
  });
});

describe("suspend and reactivate", () => {
  it("requires a reason that is not blank and at most 500 characters", async () => {
    if (!autoTenant) throw new Error("the auto-mode tenant was not created");
    for (const reason of ["", "   \n\t ", "x".repeat(501)]) {
      expect(await suspendTenant(autoTenant.id, reason, actor())).toMatchObject({
        ok: false,
        reason: "validation",
      });
    }
    expect((await tenantRow(autoTenant.id))?.status).toBe("active");
  });

  it("refuses unknown tenants and tenants that are not active", async () => {
    expect(await suspendTenant(randomUUID(), "Reason", actor())).toMatchObject({ reason: "not_found" });
    expect(await suspendTenant("bogus", "Reason", actor())).toMatchObject({ reason: "not_found" });
    const pending = await createOk(manualInput("notactive"));
    expect(await suspendTenant(pending, "Reason", actor())).toMatchObject({
      ok: false,
      reason: "invalid_state",
      message: "Only an active tenant can be suspended.",
    });
    expect(await reactivateTenant(pending, actor())).toMatchObject({ ok: false, reason: "invalid_state" });
    expect(await reactivateTenant(randomUUID(), actor())).toMatchObject({ reason: "not_found" });
  });

  it("suspends an active tenant with the reason, time and an audit event, once", async () => {
    if (!autoTenant) throw new Error("the auto-mode tenant was not created");
    const [first, second] = await Promise.all([
      suspendTenant(autoTenant.id, "  Unpaid invoice  ", actor()),
      suspendTenant(autoTenant.id, "Duplicate click", actor()),
    ]);
    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    const row = await tenantRow(autoTenant.id);
    const reason = first.ok ? "Unpaid invoice" : "Duplicate click";
    expect(row).toMatchObject({ status: "suspended", status_reason: reason });
    expect(row?.suspended_at).toBeInstanceOf(Date);

    const audit = await db.query<{ metadata: unknown; actor_id: string }>(
      "SELECT metadata, actor_id FROM audit_events WHERE tenant_id = $1 AND action = 'tenant.suspended'",
      [autoTenant.id],
    );
    expect(audit.rows).toStrictEqual([{ metadata: { reason }, actor_id: ownerId }]);

    const details = await getTenantDetails(autoTenant.id);
    observed.push(details);
    expect(details?.suspension).toStrictEqual({
      at: row?.suspended_at?.toISOString(),
      by: ownerUsername,
      // A platform owner's username: the page masks it behind an eye button.
      byIsUsername: true,
      reason,
    });
    expect(await suspendTenant(autoTenant.id, "Again", actor())).toMatchObject({ reason: "invalid_state" });
  });

  it("reactivates a suspended tenant, keeping suspended_at and both events in the history", async () => {
    if (!autoTenant) throw new Error("the auto-mode tenant was not created");
    const suspendedAt = (await tenantRow(autoTenant.id))?.suspended_at;
    expect(await reactivateTenant(autoTenant.id, actor())).toStrictEqual({ ok: true });
    const row = await tenantRow(autoTenant.id);
    expect(row).toMatchObject({ status: "active", status_reason: null, suspended_at: suspendedAt });
    expect(await reactivateTenant(autoTenant.id, actor())).toMatchObject({ reason: "invalid_state" });

    const details = await getTenantDetails(autoTenant.id);
    observed.push(details);
    expect(details?.suspension).toBeNull();
    expect(details?.history.map((entry) => entry.action)).toStrictEqual([
      "tenant.reactivated",
      "tenant.suspended",
      "tenant.provisioned",
      "tenant.created",
    ]);
    expect(details?.history[1]?.reason).toMatch(/Unpaid invoice|Duplicate click/);
    expect(details?.history[0]?.reason).toBeNull();
    // Owner actions name a username (masked on the page); system events do not.
    expect(details?.history.map((entry) => [entry.action, entry.actorIsUsername])).toStrictEqual([
      ["tenant.reactivated", true],
      ["tenant.suspended", true],
      ["tenant.provisioned", false],
      ["tenant.created", true],
    ]);
  });
});

describe("retryProvisioning", () => {
  it("is allowed for a failed tenant and an interrupted one, and nothing else", async () => {
    const make = (status: "failed" | "provisioning" | "pending" | "active" | "suspended") =>
      insertProvisioningTenant(db, { label: "retry", status });
    const failed = await make("failed");
    const interrupted = await make("provisioning");
    expect(await retryProvisioning(failed.id, actor())).toStrictEqual({ ok: true });
    expect(await retryProvisioning(interrupted.id, actor())).toStrictEqual({ ok: true });
    for (const status of ["pending", "active", "suspended"] as const) {
      const tenant = await make(status);
      expect(await retryProvisioning(tenant.id, actor())).toMatchObject({
        ok: false,
        reason: "invalid_state",
      });
    }
    expect(await retryProvisioning(randomUUID(), actor())).toMatchObject({ reason: "not_found" });
    expect(await retryProvisioning("nope", actor())).toMatchObject({ reason: "not_found" });
  });

  it("is refused while a run holds the tenant's lock", async () => {
    const tenant = await insertProvisioningTenant(db, { label: "locked", status: "provisioning" });
    const keys = ["md:tenant-provisioning", tenant.id];
    await db.query("SELECT pg_advisory_lock(hashtext($1), hashtext($2))", keys);
    try {
      expect(await retryProvisioning(tenant.id, actor())).toMatchObject({
        ok: false,
        reason: "invalid_state",
        message: "Setup is already running.",
      });
      expect((await getTenantDetails(tenant.id))?.provisioning.canRetry).toBe(false);
    } finally {
      await db.query("SELECT pg_advisory_unlock(hashtext($1), hashtext($2))", keys);
    }
    expect((await getTenantDetails(tenant.id))?.provisioning.canRetry).toBe(true);
  });

  it("is rate limited per owner (10 per 15 minutes)", async () => {
    const who = freshActor();
    const failed = await insertProvisioningTenant(db, { label: "retrylimit", status: "failed" });
    const reasons: string[] = [];
    for (let i = 0; i < 11; i += 1) {
      const result = await retryProvisioning(failed.id, who);
      reasons.push(result.ok ? "ok" : result.reason);
    }
    expect(reasons).toStrictEqual([...Array(10).fill("ok"), "rate_limited"]);
  });
});

describe("startProvisioning", () => {
  it("never throws, also for an unknown or malformed id", async () => {
    expect(await startProvisioning(randomUUID(), actor())).toMatchObject({ status: "invalid_state" });
    expect(await startProvisioning("x", actor())).toStrictEqual({
      status: "invalid_state",
      tenantStatus: "not_found",
    });
  });
});

describe("secrets", () => {
  it("never appear in a DTO or the console", () => {
    const json = JSON.stringify(observed);
    for (const forbidden of ["passwordHash", "pendingAdminPasswordHash", "databaseSecretRef", "ciphertext", "secretRef"]) {
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

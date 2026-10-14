/**
 * src/lib/tenants/database-target.ts against the scratch database, and the
 * tenant client cache in src/lib/db/tenant.ts (no connection is opened).
 */
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getControlDb } from "@/lib/db/control";
import { evictTenantDb, getTenantDb, type TenantDatabase } from "@/lib/db/tenant";
import { createSecret } from "@/lib/secrets";
import { loadTenantDatabase, TenantDatabaseConfigError } from "@/lib/tenants/database-target";
import { closeAppDatabase } from "./support/app-connections";
import { clearTenantTables, connectToTestDatabase, insertTenant } from "./support/postgres";

const PASSWORD = "vt-tenant-db-password-0123456789";

let db: Client;

beforeAll(async () => {
  db = await connectToTestDatabase();
});

beforeEach(async () => {
  await clearTenantTables(db);
});

afterAll(async () => {
  await clearTenantTables(db);
  await db.end();
  await closeAppDatabase();
});

/** The error `loadTenantDatabase` rejects with; it must be a TenantDatabaseConfigError. */
async function configError(tenantId: string): Promise<TenantDatabaseConfigError> {
  const error = await loadTenantDatabase(tenantId).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(TenantDatabaseConfigError);
  return error as TenantDatabaseConfigError;
}

async function completeTenant(slug: string): Promise<string> {
  const secretId = await createSecret(getControlDb(), "tenant_database_password", PASSWORD);
  return insertTenant(db, {
    slug,
    databaseName: `t_${slug.replaceAll("-", "_")}`,
    databaseUser: `t_${slug.replaceAll("-", "_")}_app`,
    databasePort: 5433,
    databaseSecretRef: secretId,
  });
}

describe("loadTenantDatabase", () => {
  it("builds the target from the control plane and the secret store", async () => {
    const tenantId = await completeTenant("vt-target");
    expect(await loadTenantDatabase(tenantId)).toStrictEqual({
      tenantId,
      database: "t_vt_target",
      user: "t_vt_target_app",
      password: PASSWORD,
      port: 5433,
    });
  });

  it.each(["not-a-uuid", "", randomUUID()])("reports tenant %j as not found", async (tenantId) => {
    expect((await configError(tenantId)).problem).toBe("tenant_not_found");
  });

  it.each([
    ["no database at all", {}],
    ["no secret reference", { databaseName: "t_x", databaseUser: "t_x_app", databasePort: 5432 }],
    ["no port", { databaseName: "t_x", databaseUser: "t_x_app", databaseSecretRef: randomUUID() }],
  ])("reports a tenant with %s as incomplete", async (_description, values) => {
    const tenantId = await insertTenant(db, { slug: "vt-incomplete", ...values });
    const error = await configError(tenantId);
    expect(error.problem).toBe("incomplete");
    expect(error.message).toContain(tenantId);
  });

  it("reports a missing secret as unavailable", async () => {
    const tenantId = await insertTenant(db, {
      slug: "vt-no-secret",
      databaseName: "t_x",
      databaseUser: "t_x_app",
      databasePort: 5432,
      databaseSecretRef: randomUUID(),
    });
    expect((await configError(tenantId)).problem).toBe("secret_unavailable");
  });

  it("reports an undecryptable secret as unavailable, without the password", async () => {
    const tenantId = await completeTenant("vt-tampered");
    await db.query(
      "UPDATE secrets SET auth_tag = set_byte(auth_tag, 0, get_byte(auth_tag, 0) # 1)",
    );
    const error = await configError(tenantId);
    expect(error.problem).toBe("secret_unavailable");
    expect(`${error.message} ${String(error.stack)}`).not.toContain(PASSWORD);
  });
});

describe("the tenant client cache", () => {
  const target = (overrides: Partial<TenantDatabase> = {}): TenantDatabase => ({
    tenantId: "vt-cache-tenant",
    database: "t_vt_cache",
    user: "t_vt_cache_app",
    password: PASSWORD,
    port: 5432,
    ...overrides,
  });

  it("reuses a client for the same target and replaces it when the port changes", () => {
    const first = getTenantDb(target());
    expect(getTenantDb(target())).toBe(first);
    const moved = getTenantDb(target({ port: 5433 }));
    expect(moved).not.toBe(first);
    evictTenantDb("vt-cache-tenant");
  });

  it("evictTenantDb drops the cached client, and is a no-op for unknown tenants", () => {
    const first = getTenantDb(target());
    evictTenantDb("vt-cache-tenant");
    expect(getTenantDb(target())).not.toBe(first);
    evictTenantDb("vt-cache-tenant");
    expect(() => evictTenantDb("vt-unknown-tenant")).not.toThrow();
  });
});

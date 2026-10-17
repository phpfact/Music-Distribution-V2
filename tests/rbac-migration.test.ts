/**
 * The rbac data migrations (prisma/control/migrations/20261016120000_rbac and
 * prisma/tenant/migrations/20261016120000_rbac) on pre-existing data
 * (.vibe/memory/role-privilege-management.md, "Migration of existing data").
 *
 * Each case builds a scratch database with every migration BEFORE the rbac
 * one, inserts legacy rows, applies the rbac migration, checks the mapping,
 * then applies it a second time and checks that nothing changed (idempotent).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { permissionKeysOfDomain, permissionsOfDomain } from "@/lib/authz/catalog";
import { connectTo, createTestDatabase, dropTestDatabase } from "./support/postgres";

const RBAC_MIGRATION = "20261016120000_rbac";
const devDatabase    = process.env.PLATFORM_TEST_DEV_DATABASE ?? "";
const SCRATCH        = { control: `${devDatabase}_rbac_ctl_test`, tenant: `${devDatabase}_rbac_tnt_test` } as const;

let open: Client | null = null;

afterEach(async () => {
  await open?.end().catch(() => undefined);
  open = null;
  await dropTestDatabase(SCRATCH.control);
  await dropTestDatabase(SCRATCH.tenant);
});

afterAll(async () => {
  await dropTestDatabase(SCRATCH.control);
  await dropTestDatabase(SCRATCH.tenant);
});

/** The SQL of every migration of a schema, in applying order. */
function migrationsOf(kind: "control" | "tenant"): { name: string; sql: string }[] {
  const directory = path.join(process.cwd(), "prisma", kind, "migrations");
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({ name, sql: readFileSync(path.join(directory, name, "migration.sql"), "utf8") }));
}

/** A fresh scratch database with every migration before the rbac one applied. */
async function legacyDatabase(kind: "control" | "tenant"): Promise<{ client: Client; rbac: string }> {
  const name = SCRATCH[kind];
  await dropTestDatabase(name);
  await createTestDatabase(name);
  const client = await connectTo(name);
  open = client;
  const migrations = migrationsOf(kind);
  const rbac = migrations.find((migration) => migration.name === RBAC_MIGRATION);
  if (!rbac) throw new Error(`the ${kind} rbac migration is missing`);
  for (const migration of migrations) {
    if (migration.name >= RBAC_MIGRATION) break;
    await client.query(migration.sql);
  }
  return { client, rbac: rbac.sql };
}

/** Rows of a query as plain JSON (stable across runs when ordered). */
async function rows(client: Client, sql: string): Promise<unknown[]> {
  return (await client.query(sql)).rows;
}

// ---------------------------------------------------------------------------
// Control plane

/** Everything the control mapping decides, without timestamps. */
async function controlSnapshot(client: Client): Promise<unknown> {
  return {
    owners: await rows(
      client,
      `SELECT o.username, o.is_primary, r.name AS role, r.system_key
       FROM platform_owners o JOIN platform_roles r ON r.id = o.role_id ORDER BY o.username`,
    ),
    roles: await rows(client, "SELECT id, name, status::text AS status, system_key FROM platform_roles ORDER BY name"),
    grants: await rows(
      client,
      `SELECT r.name, rp.permission_key FROM platform_role_permissions rp
       JOIN platform_roles r ON r.id = rp.role_id ORDER BY r.name, rp.permission_key`,
    ),
    permissions: await rows(client, "SELECT key, module_key, action, label, description, sort_order FROM platform_permissions ORDER BY key COLLATE \"C\""),
  };
}

/** The privilege keys stored on a platform role, by name. */
async function grantsOf(client: Client, roleName: string): Promise<string[]> {
  const result = await client.query<{ key: string }>(
    `SELECT rp.permission_key AS key FROM platform_role_permissions rp
     JOIN platform_roles r ON r.id = rp.role_id WHERE r.name = $1 ORDER BY rp.permission_key COLLATE "C"`,
    [roleName],
  );
  return result.rows.map((row) => row.key);
}

describe("control-plane rbac migration", () => {
  it("is safe on an empty database and can run again", async () => {
    const { client, rbac } = await legacyDatabase("control");
    await client.query(rbac);
    const first = await controlSnapshot(client);
    expect(first).toMatchObject({
      owners: [],
      roles: [{ name: "Master Platform", status: "active", system_key: "master_platform" }],
      grants: [],
    });
    expect((first as { permissions: unknown[] }).permissions).toHaveLength(permissionKeysOfDomain("platform").length);
    const flag = await client.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'platform_owners' AND column_name = 'can_manage_appearance'",
    );
    expect(flag.rowCount).toBe(0);

    await client.query(rbac);
    expect(await controlSnapshot(client)).toStrictEqual(first);
  });

  it("maps existing owners: the oldest active one becomes primary master, others keep only their old capabilities", async () => {
    const { client, rbac } = await legacyDatabase("control");
    // Legacy owners: the oldest is disabled, so the oldest ACTIVE one becomes primary.
    await client.query(
      `INSERT INTO platform_owners (id, username, password_hash, status, created_at, can_manage_appearance) VALUES
         (gen_random_uuid(), 'vt-old-disabled', 'h', 'disabled', now() - interval '4 days', true),
         (gen_random_uuid(), 'vt-first-active', 'h', 'active',   now() - interval '3 days', true),
         (gen_random_uuid(), 'vt-second',       'h', 'active',   now() - interval '2 days', true),
         (gen_random_uuid(), 'vt-personal',     'h', 'active',   now() - interval '1 days', false)`,
    );
    await client.query(rbac);

    // Step 1: one primary, holding Master Platform.
    const snapshot = (await controlSnapshot(client)) as { owners: unknown[] };
    expect(snapshot.owners).toStrictEqual([
      { username: "vt-first-active", is_primary: true, role: "Master Platform", system_key: "master_platform" },
      { username: "vt-old-disabled", is_primary: false, role: "Legacy Platform Owner", system_key: null },
      { username: "vt-personal", is_primary: false, role: "Legacy Platform Owner (personal appearance)", system_key: null },
      { username: "vt-second", is_primary: false, role: "Legacy Platform Owner", system_key: null },
    ]);

    // Step 2: exactly the pre-existing capabilities; no new management privileges.
    const oldCapabilities = permissionKeysOfDomain("platform").filter(
      (key) => key.startsWith("platform.tenants.") || key.startsWith("platform.tenant_registrations."),
    );
    expect(await grantsOf(client, "Legacy Platform Owner")).toStrictEqual(
      [...oldCapabilities, "platform.appearance.manage_global"].sort(),
    );
    expect(await grantsOf(client, "Legacy Platform Owner (personal appearance)")).toStrictEqual([...oldCapabilities].sort());
    for (const name of ["Legacy Platform Owner", "Legacy Platform Owner (personal appearance)"]) {
      const granted = await grantsOf(client, name);
      for (const managementModule of ["platform.roles.", "platform.users.", "platform.modules.", "platform.tenant_modules."]) {
        expect(granted.some((key) => key.startsWith(managementModule)), `${name} ${managementModule}`).toBe(false);
      }
    }

    // Step 3: the old column is gone and every owner has a role.
    const roleless = await client.query("SELECT 1 FROM platform_owners WHERE role_id IS NULL");
    expect(roleless.rowCount).toBe(0);

    // Step 4: running it again changes nothing.
    const before = await controlSnapshot(client);
    await client.query(rbac);
    expect(await controlSnapshot(client)).toStrictEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Tenant database

/** Everything the tenant mapping decides, without timestamps. */
async function tenantSnapshot(client: Client): Promise<unknown> {
  return {
    roles: await rows(
      client,
      `SELECT id, key, name, domain::text AS domain, system_key, status::text AS status, is_system, owner_customer_id
       FROM roles ORDER BY key`,
    ),
    users: await rows(
      client,
      `SELECT u.username, u.is_primary, r.key AS role
       FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
       ORDER BY u.username`,
    ),
    grants: await rows(client, "SELECT role_id, permission_id FROM role_permissions ORDER BY role_id, permission_id"),
    permissions: await rows(
      client,
      "SELECT id, key, domain::text AS domain, module_key, action, label, description, sort_order FROM permissions ORDER BY key COLLATE \"C\"",
    ),
    customers: await rows(client, "SELECT name, status::text AS status FROM customers ORDER BY name"),
  };
}

describe("tenant rbac migration", () => {
  it("is safe on an empty database and can run again", async () => {
    const { client, rbac } = await legacyDatabase("tenant");
    await client.query(rbac);
    const first = (await tenantSnapshot(client)) as { roles: unknown[]; permissions: unknown[] };
    expect(first.roles).toMatchObject([
      { key: "master_customer", name: "Master Customer", domain: "customer", system_key: "master_customer", status: "active", is_system: true },
      { key: "owner", name: "Master Tenant", domain: "tenant", system_key: "master_tenant", status: "active", is_system: true },
    ]);
    expect(first.permissions).toHaveLength(permissionKeysOfDomain("tenant").length + permissionKeysOfDomain("customer").length);

    await client.query(rbac);
    expect(await tenantSnapshot(client)).toStrictEqual(first);
  });

  it("maps existing roles and users: owner → Master Tenant + primary, approved customers → Master Customer + primary, nobody else", async () => {
    const { client, rbac } = await legacyDatabase("tenant");
    // Legacy roles and a legacy privilege outside the catalog.
    await client.query(
      `INSERT INTO roles (id, key, name, is_system, updated_at) VALUES
         (gen_random_uuid(), 'owner', 'Owner', true, now()),
         (gen_random_uuid(), 'editor', 'Editor', false, now())`,
    );
    await client.query("INSERT INTO permissions (id, key) VALUES (gen_random_uuid(), 'customers.create')");
    await client.query(
      "INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r, permissions p WHERE r.key = 'editor'",
    );
    // Staff: the admin (owner + editor: duplicate links), a plain staff user.
    await client.query(
      `INSERT INTO users (id, email, username, password_hash, name, created_at, updated_at) VALUES
         (gen_random_uuid(), 'admin@example.com', 'vt-admin', 'h', 'Admin', now() - interval '2 days', now()),
         (gen_random_uuid(), 'staff@example.com', 'vt-staff', 'h', 'Staff', now() - interval '1 days', now())`,
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT u.id, r.id FROM users u, roles r
       WHERE (u.username = 'vt-admin' AND r.key IN ('owner', 'editor')) OR (u.username = 'vt-staff' AND r.key = 'editor')`,
    );
    // Customers: an approved, suspended account; an approved active account
    // whose user wrongly holds the owner role; a customer user without a registration.
    await client.query(
      `INSERT INTO customers (id, type, name, updated_at) VALUES
         (gen_random_uuid(), 'artist', 'Suspended Artist', now()),
         (gen_random_uuid(), 'label', 'Active Label', now()),
         (gen_random_uuid(), 'artist', 'Unregistered', now())`,
    );
    await client.query(
      `INSERT INTO users (id, email, username, password_hash, name, status, customer_id, updated_at)
       SELECT gen_random_uuid(), lower(replace(c.name, ' ', '')) || '@example.com', 'vt-' || lower(replace(c.name, ' ', '-')), 'h', c.name,
              CASE WHEN c.name = 'Suspended Artist' THEN 'disabled'::user_status ELSE 'active'::user_status END, c.id, now()
       FROM customers c`,
    );
    await client.query(
      `INSERT INTO customer_registrations (id, full_name, email, username, password_hash, account_type, status, user_id, updated_at)
       SELECT gen_random_uuid(), u.name, u.email, u.username, 'h', 'artist', 'approved', u.id, now()
       FROM users u WHERE u.username IN ('vt-suspended-artist', 'vt-active-label')`,
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT u.id, r.id FROM users u, roles r WHERE u.username = 'vt-active-label' AND r.key = 'owner'`,
    );

    await client.query(rbac);
    const snapshot = (await tenantSnapshot(client)) as {
      roles: unknown[];
      users: unknown[];
      grants: unknown[];
      permissions: { key: string }[];
      customers: unknown[];
    };

    // Step 1: roles — owner kept as Master Tenant, Master Customer added, legacy role inert.
    expect(snapshot.roles).toMatchObject([
      { key: "editor", name: "Editor (editor)", domain: "tenant", system_key: null, status: "disabled", is_system: false },
      { key: "master_customer", name: "Master Customer", domain: "customer", system_key: "master_customer", status: "active" },
      { key: "owner", name: "Master Tenant", domain: "tenant", system_key: "master_tenant", status: "active" },
    ]);

    // Step 2: one role per user; nobody else gets a role (fail secure).
    expect(snapshot.users).toStrictEqual([
      { username: "vt-active-label", is_primary: true, role: "master_customer" },
      { username: "vt-admin", is_primary: true, role: "owner" },
      { username: "vt-staff", is_primary: false, role: null },
      { username: "vt-suspended-artist", is_primary: true, role: "master_customer" },
      { username: "vt-unregistered", is_primary: false, role: null },
    ]);

    // Step 3: the catalog replaced the legacy privilege (its links are gone).
    expect(snapshot.grants).toStrictEqual([]);
    expect(snapshot.permissions.map((permission) => permission.key)).toStrictEqual(
      [...permissionsOfDomain("tenant"), ...permissionsOfDomain("customer")].map((permission) => permission.key).sort(),
    );

    // Step 4: a suspended approved account suspends its main customer row too.
    expect(snapshot.customers).toStrictEqual([
      { name: "Active Label", status: "active" },
      { name: "Suspended Artist", status: "disabled" },
      { name: "Unregistered", status: "active" },
    ]);

    // Step 5: user_id is now the key of user_roles, and running it again changes nothing.
    const key = await client.query<{ columns: number }>(
      "SELECT array_length(conkey, 1) AS columns FROM pg_constraint WHERE conname = 'user_roles_pkey'",
    );
    expect(key.rows).toStrictEqual([{ columns: 1 }]);
    const before = await tenantSnapshot(client);
    await client.query(rbac);
    expect(await tenantSnapshot(client)).toStrictEqual(before);
  });
});

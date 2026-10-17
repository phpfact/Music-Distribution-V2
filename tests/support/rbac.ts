/**
 * Helpers of the RBAC service tests (tests/rbac-roles.test.ts,
 * tests/rbac-sub-users.test.ts): actors built exactly like the guards build
 * them (real sessions, fresh access), real provisioned tenants, and small raw
 * inserts through the tenant's low-privilege runtime login.
 */
import { randomBytes } from "node:crypto";
import type { Client } from "pg";
import { customerActor, platformActor, tenantActor, type CustomerAuthzActor, type TenantAuthzActor } from "@/lib/authz/actor";
import { loadPlatformAccess } from "@/lib/authz/platform-access";
import { loadDisabledTenantModules, resolveWorkspaceAccess } from "@/lib/authz/workspace-access";
import { getControlDb } from "@/lib/db/control";
import { loadTenantDatabase } from "@/lib/tenants/database-target";
import type { ReadyWorkspace } from "@/lib/workspace/context";
import { approveRegistration } from "@/lib/workspace/registrations";
import { createUserSession, validateUserSession } from "@/lib/workspace/sessions";
import { connectAs } from "./tenant-resources";
import { createProvisionedTenant, readyWorkspace, type ProvisionedTenant } from "./workspace";

/** A password that satisfies the shared password rule. */
export const STRONG_PASSWORD = "Strong-Pass-2026!";

/** A provisioned tenant with its workspace, a runtime-login connection and its admin. */
export type RbacTenant = {
  tenant: ProvisionedTenant;
  ws: ReadyWorkspace;
  rt: Client;
  adminId: string;
  masterTenantId: string;
  masterCustomerId: string;
};

/** A short random lower-case suffix for unique names. */
export function suffix(): string {
  return randomBytes(3).toString("hex");
}

/** A random suffix made of letters only (full names may not contain digits). */
export function letters(length = 6): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  return Array.from(randomBytes(length), (byte) => alphabet[byte % alphabet.length]).join("");
}

/** The single value `id` of a one-row query. */
export async function one(client: Client, sql: string, values: unknown[] = []): Promise<string> {
  const result = await client.query<{ id: string }>(sql, values);
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`no row: ${sql}`);
  return id;
}

/** Creates and provisions a tenant and opens everything the tests need. */
export async function openRbacTenant(label: string, actorId: string): Promise<RbacTenant> {
  const tenant = await createProvisionedTenant(label, { ownerId: actorId, ipAddress: "203.0.113.230" });
  const ws     = await readyWorkspace(tenant);
  const target = await loadTenantDatabase(tenant.id);
  const rt     = await connectAs({ database: target.database, user: target.user, password: target.password, port: target.port });
  return {
    tenant,
    ws,
    rt,
    adminId: await one(rt, "SELECT id FROM users WHERE username = $1", [tenant.adminUsername]),
    masterTenantId: await one(rt, "SELECT id FROM roles WHERE system_key = 'master_tenant'"),
    masterCustomerId: await one(rt, "SELECT id FROM roles WHERE system_key = 'master_customer'"),
  };
}

/** Closes the connections of a tenant opened by openRbacTenant. */
export async function closeRbacTenant(t: RbacTenant | undefined): Promise<void> {
  await t?.rt.end().catch(() => undefined);
  await t?.ws.db.$disconnect().catch(() => undefined);
}

/** The platform actor of an owner, exactly as a Server Action builds it. */
export async function platformActorOf(ownerId: string) {
  const access = await loadPlatformAccess(getControlDb(), ownerId);
  return platformActor({ access }, { ipAddress: "203.0.113.231" });
}

/** Signs a workspace user in (real session) and builds their actor like the guards do. */
export async function tenantActorOf(t: RbacTenant, userId: string): Promise<TenantAuthzActor> {
  const token = await createUserSession(t.ws.db, t.tenant.id, userId, "tenant");
  const user  = await validateUserSession(t.ws.db, t.tenant.id, "tenant", token);
  if (!user) throw new Error("tenant session refused");
  const disabledModules = await loadDisabledTenantModules(getControlDb(), t.tenant.id);
  const authz = resolveWorkspaceAccess(user, "tenant", disabledModules);
  return tenantActor({ tenant: t.ws.tenant, db: t.ws.db, user, authz }, { disabledModules });
}

/** Signs a customer user in (real session) and builds their actor like the guards do. */
export async function customerActorOf(t: RbacTenant, userId: string): Promise<CustomerAuthzActor> {
  const token = await createUserSession(t.ws.db, t.tenant.id, userId, "customer");
  const user  = await validateUserSession(t.ws.db, t.tenant.id, "customer", token);
  if (!user?.customer) throw new Error("customer session refused");
  const disabledModules = await loadDisabledTenantModules(getControlDb(), t.tenant.id);
  const authz = resolveWorkspaceAccess(user, "customer", disabledModules);
  return customerActor({ tenant: t.ws.tenant, db: t.ws.db, user: { ...user, customer: user.customer }, authz }, { disabledModules });
}

/** Inserts a user (staff when no customer is given) through the runtime login. */
export async function insertUser(client: Client, user: { handle: string; customerId?: string }): Promise<string> {
  const handle = `vt-${user.handle}-${suffix()}`;
  return one(
    client,
    `INSERT INTO users (id, email, username, password_hash, name, customer_id, updated_at)
     VALUES (gen_random_uuid(), $1, $2, 'h', $3, $4, now()) RETURNING id`,
    [`${handle}@example.com`, handle, `VT ${user.handle}`, user.customerId ?? null],
  );
}

/** Inserts a customer (a sub-customer when a parent is given). */
export async function insertCustomer(client: Client, name: string, parentId: string | null): Promise<string> {
  return one(
    client,
    "INSERT INTO customers (id, type, name, parent_id, updated_at) VALUES (gen_random_uuid(), 'artist', $1, $2, now()) RETURNING id",
    [name, parentId],
  );
}

/** Inserts a custom role with the given catalog keys. */
export async function insertRole(
  client: Client,
  role: { name: string; domain: "tenant" | "customer"; owner?: string; keys: string[]; status?: "active" | "disabled" },
): Promise<string> {
  const id = await one(
    client,
    `INSERT INTO roles (id, name, domain, owner_customer_id, status, updated_at)
     VALUES (gen_random_uuid(), $1, $2::authz_domain, $3, $4::role_status, now()) RETURNING id`,
    [role.name, role.domain, role.owner ?? null, role.status ?? "active"],
  );
  await client.query(
    "INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE key = ANY($2::text[])",
    [id, role.keys],
  );
  return id;
}

/** Gives a user exactly one role (upsert on user_id). */
export async function assignRole(client: Client, userId: string, roleId: string): Promise<void> {
  await client.query(
    "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id",
    [userId, roleId],
  );
}

/** The sorted privilege keys stored on a tenant-database role. */
export async function workspaceRoleKeys(client: Client, roleId: string): Promise<string[]> {
  const result = await client.query<{ key: string }>(
    "SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1 ORDER BY p.key",
    [roleId],
  );
  return result.rows.map((row) => row.key);
}

/** A pending registration approved through the real service (main customer + Master Customer + primary). */
export async function approvedCustomer(t: RbacTenant, fullName: string): Promise<{ customerId: string; userId: string; registrationId: string }> {
  const handle = `vt-cust-${suffix()}`;
  const registrationId = await one(
    t.rt,
    `INSERT INTO customer_registrations (id, full_name, email, username, password_hash, account_type, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, '$argon2id$placeholder', 'label', now()) RETURNING id`,
    [fullName, `${handle}@example.com`, handle],
  );
  const outcome = await approveRegistration(t.ws.db, t.tenant.id, registrationId, { type: "tenant_user", id: t.adminId }, null);
  if (!outcome.ok) throw new Error(`approval failed: ${JSON.stringify(outcome)}`);
  const user = await t.rt.query<{ id: string; customer_id: string }>("SELECT id, customer_id FROM users WHERE username = $1", [handle]);
  const row = user.rows[0];
  if (!row) throw new Error("approved user missing");
  return { customerId: row.customer_id, userId: row.id, registrationId };
}

/** Audit rows of one action by one actor (control plane). */
export async function auditRows(control: Client, action: string, actorId: string): Promise<{ target_id: string | null; metadata: Record<string, unknown> | null }[]> {
  const result = await control.query<{ target_id: string | null; metadata: Record<string, unknown> | null }>(
    "SELECT target_id, metadata FROM audit_events WHERE action = $1 AND actor_id = $2 ORDER BY occurred_at, id",
    [action, actorId],
  );
  return result.rows;
}

/**
 * Waits until some backend of the cluster is blocked on a row lock (a service
 * transaction waiting for a lock the test holds). Throws after ~5 s.
 */
export async function waitForLockWaiter(control: Client): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await control.query<{ waiting: number }>(
      "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND pid <> pg_backend_pid()",
    );
    if ((result.rows[0]?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("no transaction is waiting for the lock");
}

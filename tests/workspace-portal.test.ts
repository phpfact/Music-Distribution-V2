/**
 * The tenant portal's services against REAL provisioned tenant databases
 * (.vibe/memory/workspace-auth.md, customer-registration.md,
 * workspace-appearance.md): sessions and their tenant/area binding, the shared
 * sign-in, customer sign-up, approval, rejection with review requests,
 * suspension, cross-tenant isolation, appearance and Platform Owner access.
 *
 * Two tenants are created and provisioned like the Platform Owner panel does
 * (t_test_... databases on the dev PostgreSQL, dropped at the end).
 * Rate-limit counters of these tenants are deleted after every test.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { createClient } from "redis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@/lib/platform-auth/password";
import { getPublicAppearance, getViewerAppearanceState, saveViewerAppearance } from "@/lib/workspace/appearance";
import { authenticateWorkspaceUser } from "@/lib/workspace/login";
import { openTenantForPlatformOwner } from "@/lib/workspace/platform-access";
import {
  approveRegistration,
  getRegistrationSummary,
  listRegistrations,
  rejectRegistration,
  requestRegistrationReview,
  setCustomerAccountStatus,
  submitRegistration,
} from "@/lib/workspace/registrations";
import {
  hashWorkspaceToken,
  revokeUserSession,
  validateRegistrationSession,
  validateUserSession,
} from "@/lib/workspace/sessions";
import { createTestUserSession as createUserSession } from "./support/workspace-session";
import type { ReadyWorkspace } from "@/lib/workspace/context";
import { closeAppDatabase, closeAppRedis } from "./support/app-connections";
import { captureConsole } from "./support/console";
import { clearTenantTables, connectToTestDatabase, insertOwner } from "./support/postgres";
import { randomLabel, randomLetters, TenantResources } from "./support/tenant-resources";
import { createProvisionedTenant, readyWorkspace, type ProvisionedTenant } from "./support/workspace";

// Provisioning two real tenant databases takes a while.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let db: Client;
let resources: TenantResources;
let redis: ReturnType<typeof createClient>;
let consoleOutput: { text: () => string };
let ownerId: string;
let tenantA: ProvisionedTenant;
let tenantB: ProvisionedTenant;
let wsA: ReadyWorkspace;
let wsB: ReadyWorkspace;
let nextIp = 10;

// Every secret the tests know of: none may appear in the server log.
const secrets = new Set<string>();

beforeAll(async () => {
  db = await connectToTestDatabase();
  await clearTenantTables(db);
  resources = await TenantResources.open(db);
  ownerId = await insertOwner(db, {
    username: `ws-owner-${randomLabel(8)}`,
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

  // Fresh actor ids: tenant creation is rate limited per owner.
  tenantA = await createProvisionedTenant("porta", { ownerId: randomUUID(), ipAddress: "203.0.113.200" });
  tenantB = await createProvisionedTenant("portb", { ownerId: randomUUID(), ipAddress: "203.0.113.201" });
  secrets.add(tenantA.adminPassword);
  secrets.add(tenantB.adminPassword);
  wsA = await readyWorkspace(tenantA);
  wsB = await readyWorkspace(tenantB);
  consoleOutput = captureConsole();
});

// Every test starts with fresh rate-limit budgets for both tenants.
afterEach(async () => {
  for (const tenant of [tenantA, tenantB]) {
    if (!tenant) continue;
    const keys = await redis.keys(`rl:ws-*:${tenant.id}*`);
    if (keys.length > 0) await redis.del(keys);
  }
});

afterAll(async () => {
  vi.restoreAllMocks();
  await wsA?.db.$disconnect().catch(() => undefined);
  await wsB?.db.$disconnect().catch(() => undefined);
  await resources.cleanup();
  await clearTenantTables(db);
  if (ownerId) await db.query("DELETE FROM platform_owners WHERE id = $1", [ownerId]);
  await resources.close();
  await db.end();
  redis.destroy();
  await closeAppDatabase();
  await closeAppRedis();
});

// ---------------------------------------------------------------------------
// Helpers

/** A documentation address of its own for each call (separate IP budgets). */
function ip(): string {
  nextIp += 1;
  return `198.51.100.${nextIp}`;
}

type SignupForm = Record<"fullName" | "accountType" | "email" | "username" | "password" | "confirmPassword", string>;

/** A valid sign-up form for a unique applicant. */
function signup(overrides: Partial<SignupForm> = {}): SignupForm {
  const handle   = `cust-${randomLabel(8)}`;
  const password = `Cu-${randomBytes(12).toString("base64url")}`;
  secrets.add(password);
  return {
    fullName: `Asha ${randomLetters(6)}`,
    accountType: "artist",
    email: `${handle}@example.com`,
    username: handle,
    password,
    confirmPassword: password,
    ...overrides,
  };
}

/** Submits a sign-up and returns its registration id (it must succeed). */
async function submitted(ws: ReadyWorkspace, form = signup()): Promise<{ id: string; form: SignupForm }> {
  const result = await submitRegistration(ws.db, ws.tenant.id, form, ip());
  if (!result.ok) throw new Error(`sign-up failed: ${JSON.stringify(result)}`);
  const row = await ws.db.customerRegistration.findFirstOrThrow({ where: { email: form.email }, select: { id: true } });
  return { id: row.id, form };
}

/** The tenant admin's user id in a tenant database. */
async function adminId(ws: ReadyWorkspace, tenant: ProvisionedTenant): Promise<string> {
  const user = await ws.db.user.findFirstOrThrow({ where: { username: tenant.adminUsername }, select: { id: true } });
  return user.id;
}

const ownerActor = (id: string) => ({ type: "tenant_user" as const, id });

// ---------------------------------------------------------------------------

describe("sessions", () => {
  it("bind a token to its tenant and area, and end on revoke or idleness", async () => {
    const userId = await adminId(wsA, tenantA);
    const token  = await createUserSession(wsA.db, tenantA.id, userId, "tenant");

    const user = await validateUserSession(wsA.db, tenantA.id, "tenant", token);
    expect(user).toMatchObject({ id: userId, role: { systemKey: "master_tenant" }, customer: null });
    // The same token is worthless in the other area and on another tenant.
    expect(await validateUserSession(wsA.db, tenantA.id, "customer", token)).toBeNull();
    expect(await validateUserSession(wsB.db, tenantB.id, "tenant", token)).toBeNull();

    // Even a copied session row does not help on another tenant: the hash includes the tenant id.
    const bAdmin = await adminId(wsB, tenantB);
    await wsB.db.userSession.create({
      data: {
        userId: bAdmin,
        area: "tenant",
        tokenHash: hashWorkspaceToken(tenantA.id, "tenant", token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(await validateUserSession(wsB.db, tenantB.id, "tenant", token)).toBeNull();

    // Idle for longer than 30 minutes: refused.
    await wsA.db.userSession.updateMany({
      where: { tokenHash: hashWorkspaceToken(tenantA.id, "tenant", token) },
      data: { lastUsedAt: new Date(Date.now() - 31 * 60_000) },
    });
    expect(await validateUserSession(wsA.db, tenantA.id, "tenant", token)).toBeNull();

    const second = await createUserSession(wsA.db, tenantA.id, userId, "tenant");
    await revokeUserSession(wsA.db, tenantA.id, "tenant", second);
    expect(await validateUserSession(wsA.db, tenantA.id, "tenant", second)).toBeNull();
    expect(await validateUserSession(wsA.db, tenantA.id, "tenant", "not-a-token")).toBeNull();
  });
});

describe("sign-in", () => {
  it("signs the tenant admin in with the username or the email chosen by the Platform Owner", async () => {
    const byName = await authenticateWorkspaceUser(wsA, { identifier: tenantA.adminUsername, password: tenantA.adminPassword }, ip());
    expect(byName).toMatchObject({ ok: true, destination: "tenant" });
    const byEmail = await authenticateWorkspaceUser(
      wsA,
      { identifier: `  ${tenantA.adminEmail.toUpperCase()} `, password: tenantA.adminPassword },
      ip(),
    );
    expect(byEmail).toMatchObject({ ok: true, destination: "tenant" });
  });

  it("refuses wrong, unknown and other-tenant credentials the same way", async () => {
    const wrong = await authenticateWorkspaceUser(wsA, { identifier: tenantA.adminUsername, password: "Wrong-password-123" }, ip());
    expect(wrong).toStrictEqual({ ok: false, reason: "invalid_credentials" });
    const unknown = await authenticateWorkspaceUser(wsA, { identifier: "nobody-here", password: "Whatever-123456" }, ip());
    expect(unknown).toStrictEqual({ ok: false, reason: "invalid_credentials" });
    // Tenant B's admin cannot sign in on tenant A's domain.
    const crossTenant = await authenticateWorkspaceUser(wsA, { identifier: tenantB.adminUsername, password: tenantB.adminPassword }, ip());
    expect(crossTenant).toStrictEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("validates missing fields without counting an attempt", async () => {
    expect(await authenticateWorkspaceUser(wsA, { identifier: "", password: "   " }, ip())).toStrictEqual({
      ok: false,
      reason: "validation",
      fieldErrors: { identifier: "Enter your username or email.", password: "Enter your password." },
    });
    expect(await authenticateWorkspaceUser(wsA, { identifier: 42, password: null }, ip())).toMatchObject({
      ok: false,
      reason: "validation",
    });
  });

  it("rate-limits repeated failures per identifier", async () => {
    const results: string[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const result = await authenticateWorkspaceUser(wsA, { identifier: "limit-me", password: "Wrong-password-1" }, ip());
      results.push(result.ok ? "ok" : result.reason);
    }
    expect(results.slice(0, 5).every((reason) => reason === "invalid_credentials")).toBe(true);
    expect(results[5]).toBe("rate_limited");
  });
});

describe("customer sign-up and approval", () => {
  it("stores a pending registration without creating a user or a session", async () => {
    const { id, form } = await submitted(wsA);
    const row = await wsA.db.customerRegistration.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "pending", accountType: "artist", email: form.email, userId: null });
    expect(row.passwordHash).not.toContain(form.password);
    expect(await wsA.db.user.count({ where: { email: form.email } })).toBe(0);

    // Correct password, but not approved yet: no session at all.
    const login = await authenticateWorkspaceUser(wsA, { identifier: form.username, password: form.password }, ip());
    expect(login).toStrictEqual({ ok: false, reason: "pending" });
  });

  it("rejects invalid fields and duplicates of accounts or pending requests", async () => {
    const invalid = await submitRegistration(
      wsA.db,
      tenantA.id,
      signup({ fullName: "R2D2", accountType: "manager", confirmPassword: "different" }),
      ip(),
    );
    expect(invalid).toMatchObject({ ok: false, reason: "validation" });
    if (!invalid.ok && invalid.reason === "validation") {
      expect(Object.keys(invalid.fieldErrors).sort()).toStrictEqual(["accountType", "confirmPassword", "fullName"]);
    }

    const adminDuplicate = await submitRegistration(wsA.db, tenantA.id, signup({ email: tenantA.adminEmail }), ip());
    expect(adminDuplicate).toMatchObject({ ok: false, reason: "validation", fieldErrors: { email: expect.stringContaining("already exists") } });

    const first = await submitted(wsA);
    const pendingDuplicate = await submitRegistration(wsA.db, tenantA.id, signup({ username: first.form.username }), ip());
    expect(pendingDuplicate).toMatchObject({
      ok: false,
      reason: "validation",
      fieldErrors: { username: expect.stringContaining("waiting for approval") },
    });

    // The same person may register with another tenant: identities are per tenant.
    const elsewhere = await submitRegistration(wsB.db, tenantB.id, { ...first.form }, ip());
    expect(elsewhere).toStrictEqual({ ok: true });
  });

  it("approves once: creates the customer and its user, then the customer signs in to the customer area", async () => {
    const { id, form } = await submitted(wsA, signup({ accountType: "label" }));
    const reviewer = ownerActor(await adminId(wsA, tenantA));

    expect(await approveRegistration(wsA.db, tenantA.id, id, reviewer, null)).toStrictEqual({ ok: true });
    const again = await approveRegistration(wsA.db, tenantA.id, id, reviewer, null);
    expect(again).toMatchObject({ ok: false, problem: "already_reviewed" });

    const user = await wsA.db.user.findUniqueOrThrow({ where: { email: form.email }, include: { customer: true } });
    expect(user).toMatchObject({ status: "active", username: form.username });
    expect(user.customer).toMatchObject({ type: "label", status: "active" });
    const registration = await wsA.db.customerRegistration.findUniqueOrThrow({ where: { id } });
    expect(registration).toMatchObject({ status: "approved", userId: user.id, reviewedByType: "tenant_user" });

    const login = await authenticateWorkspaceUser(wsA, { identifier: form.email, password: form.password }, ip());
    expect(login).toMatchObject({ ok: true, destination: "customer" });
    if (!login.ok) return;
    expect(await validateUserSession(wsA.db, tenantA.id, "customer", login.token)).toMatchObject({
      id: user.id,
      role: { systemKey: "master_customer" },
      customer: { type: "label" },
    });
    // A customer session never opens the tenant staff area.
    expect(await validateUserSession(wsA.db, tenantA.id, "tenant", login.token)).toBeNull();
  });

  it("never lets one tenant review another tenant's registrations", async () => {
    const { id } = await submitted(wsA);
    const intruder = ownerActor(await adminId(wsB, tenantB));
    expect(await approveRegistration(wsB.db, tenantB.id, id, intruder, null)).toMatchObject({ ok: false, problem: "not_found" });
    expect(await rejectRegistration(wsB.db, tenantB.id, id, "Not ours", intruder, null)).toMatchObject({
      ok: false,
      problem: "not_found",
    });
    expect((await wsA.db.customerRegistration.findUniqueOrThrow({ where: { id } })).status).toBe("pending");
    const listB = await listRegistrations(wsB.db, { q: "", status: "all", page: 1 });
    expect(listB.rows.some((row) => row.id === id)).toBe(false);
  });

  it("requires a reason to reject, shows it only with the right password and accepts one review request", async () => {
    const { id, form } = await submitted(wsA);
    const reviewer = { type: "platform_owner" as const, id: ownerId };

    expect(await rejectRegistration(wsA.db, tenantA.id, id, "  no ", reviewer, null)).toMatchObject({ problem: "invalid_reason" });
    expect(await rejectRegistration(wsA.db, tenantA.id, id, "Missing artist links", reviewer, null)).toStrictEqual({ ok: true });

    // Signing up again: the reason only for the applicant's own password.
    const own = await submitRegistration(wsA.db, tenantA.id, { ...form }, ip());
    expect(own).toStrictEqual({ ok: false, reason: "rejected", rejectionReason: "Missing artist links" });
    const stranger = signup({ email: form.email });
    const other = await submitRegistration(wsA.db, tenantA.id, stranger, ip());
    expect(other).toMatchObject({ ok: false, reason: "validation", fieldErrors: { email: expect.stringContaining("not approved") } });
    expect(JSON.stringify(other)).not.toContain("Missing artist links");

    // Logging in with the rejected password opens only the limited status session.
    const login = await authenticateWorkspaceUser(wsA, { identifier: form.username, password: form.password }, ip());
    expect(login).toMatchObject({ ok: true, destination: "registration" });
    if (!login.ok) return;
    expect(await validateUserSession(wsA.db, tenantA.id, "customer", login.token)).toBeNull();
    const applicant = await validateRegistrationSession(wsA.db, tenantA.id, login.token);
    expect(applicant).toMatchObject({ registrationId: id, status: "rejected", rejectionReason: "Missing artist links" });

    // One review request; a second one while it is open is refused.
    expect(await requestRegistrationReview(wsA.db, tenantA.id, id, "  Links added now  ", ip())).toStrictEqual({ ok: true });
    expect(await requestRegistrationReview(wsA.db, tenantA.id, id, "", ip())).toStrictEqual({ ok: false, reason: "not_rejected" });
    const row = await wsA.db.customerRegistration.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "pending", reviewRequestMessage: "Links added now" });
    expect(row.reviewRequestedAt).toBeInstanceOf(Date);
    const list = await listRegistrations(wsA.db, { q: form.username, status: "pending", page: 1 });
    expect(list.rows.map((entry) => entry.status)).toStrictEqual(["review_requested"]);
  });

  it("suspends and reactivates a customer account, ending its sessions at once", async () => {
    const { id, form } = await submitted(wsA);
    const reviewer = ownerActor(await adminId(wsA, tenantA));
    await approveRegistration(wsA.db, tenantA.id, id, reviewer, null);
    const login = await authenticateWorkspaceUser(wsA, { identifier: form.username, password: form.password }, ip());
    if (!login.ok) throw new Error("approved customer could not sign in");

    expect(await setCustomerAccountStatus(wsA.db, tenantA.id, id, "suspend", reviewer, null)).toStrictEqual({ ok: true });
    expect(await setCustomerAccountStatus(wsA.db, tenantA.id, id, "suspend", reviewer, null)).toMatchObject({ problem: "already_reviewed" });
    expect(await validateUserSession(wsA.db, tenantA.id, "customer", login.token)).toBeNull();
    expect(await authenticateWorkspaceUser(wsA, { identifier: form.username, password: form.password }, ip())).toStrictEqual({
      ok: false,
      reason: "suspended",
    });

    expect(await setCustomerAccountStatus(wsA.db, tenantA.id, id, "reactivate", reviewer, null)).toStrictEqual({ ok: true });
    expect(await authenticateWorkspaceUser(wsA, { identifier: form.username, password: form.password }, ip())).toMatchObject({
      ok: true,
      destination: "customer",
    });
  });

  it("counts and lists registrations at the database level", async () => {
    const summary = await getRegistrationSummary(wsA.db);
    expect(summary.total).toBe(summary.pending + summary.active + summary.suspended + summary.rejected);
    const all = await listRegistrations(wsA.db, { q: "", status: "all", page: 1 });
    expect(all.total).toBe(summary.total);
    const pending = await listRegistrations(wsA.db, { q: "", status: "pending", page: 1 });
    expect(pending.total).toBe(summary.pending);
    expect(pending.rows.every((row) => row.status === "pending" || row.status === "review_requested")).toBe(true);
    // A page beyond the end shows the last page; no password hash ever leaves the service.
    const far = await listRegistrations(wsA.db, { q: "", status: "all", page: 999 });
    expect(far.page).toBe(far.pageCount);
    expect(JSON.stringify(all)).not.toContain("argon2");
  });
});

describe("appearance", () => {
  it("resolves personal → workspace → default, and only the owner changes the workspace default", async () => {
    const admin = await adminId(wsA, tenantA);
    const owner = { userId: admin, tenantId: tenantA.id, canManageWorkspace: true };
    expect(await getPublicAppearance(wsA.db)).toStrictEqual({ theme: "light", accent: "neutral", width: "default" });

    // A customer (never an owner) cannot change the workspace default.
    const { id, form } = await submitted(wsA);
    await approveRegistration(wsA.db, tenantA.id, id, ownerActor(admin), null);
    const customer = await wsA.db.user.findUniqueOrThrow({ where: { email: form.email }, select: { id: true } });
    const viewer   = { userId: customer.id, tenantId: tenantA.id, canManageWorkspace: false };
    const denied   = await saveViewerAppearance(wsA.db, viewer, { operation: "apply", scope: "workspace", appearance: { theme: "dark", accent: "rose", width: "full" } }, null);
    expect(denied).toMatchObject({ ok: false });
    expect(await saveViewerAppearance(wsA.db, viewer, { operation: "apply", scope: "personal", appearance: { theme: "x" } }, null)).toMatchObject({ ok: false });

    // Personal choice for the customer.
    const personal = await saveViewerAppearance(wsA.db, viewer, { operation: "apply", scope: "personal", appearance: { theme: "dark", accent: "rose", width: "full" } }, null);
    expect(personal).toMatchObject({ ok: true, state: { source: "personal", appearance: { theme: "dark" } } });

    // Owner: personal, then Apply to all (workspace default + own override, the customer's override stays).
    await saveViewerAppearance(wsA.db, owner, { operation: "apply", scope: "personal", appearance: { theme: "light", accent: "blue", width: "default" } }, null);
    const all = await saveViewerAppearance(wsA.db, owner, { operation: "apply", scope: "workspace", appearance: { theme: "system", accent: "emerald", width: "focused" } }, null);
    expect(all).toMatchObject({ ok: true, state: { appearance: { theme: "system", accent: "emerald" }, workspace: { theme: "system" } } });
    expect(await getPublicAppearance(wsA.db)).toStrictEqual({ theme: "system", accent: "emerald", width: "focused" });
    expect(await getViewerAppearanceState(wsA.db, viewer)).toMatchObject({ source: "personal", appearance: { theme: "dark" } });
    // Tenant B is untouched.
    expect(await getPublicAppearance(wsB.db)).toStrictEqual({ theme: "light", accent: "neutral", width: "default" });

    // Resets.
    expect(await saveViewerAppearance(wsA.db, viewer, { operation: "reset", scope: "personal" }, null)).toMatchObject({
      ok: true,
      state: { source: "workspace", personal: null },
    });
    await saveViewerAppearance(wsA.db, owner, { operation: "reset", scope: "workspace" }, null);
    expect(await getPublicAppearance(wsA.db)).toStrictEqual({ theme: "light", accent: "neutral", width: "default" });
  });
});

describe("Platform Owner access", () => {
  it("opens only existing, set-up tenants by id", async () => {
    expect(await openTenantForPlatformOwner("not-a-uuid")).toStrictEqual({ ok: false, reason: "not_found" });
    expect(await openTenantForPlatformOwner(randomUUID())).toStrictEqual({ ok: false, reason: "not_found" });
    const access = await openTenantForPlatformOwner(tenantA.id);
    expect(access).toMatchObject({ ok: true, tenant: { id: tenantA.id, status: "active" } });
  });
});

describe("logging", () => {
  it("never writes a password, token or hash to the log", () => {
    const log = consoleOutput.text();
    for (const secret of secrets) expect(log).not.toContain(secret);
    expect(log).not.toMatch(/\$argon2id\$/);
  });
});

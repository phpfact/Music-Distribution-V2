/**
 * Real, provisioned tenants for the tenant-portal tests
 * (.vibe/memory/workspace-auth.md, customer-registration.md).
 *
 * A tenant is created and provisioned exactly as the Platform Owner panel
 * does it (createTenant + startProvisioning), so its database has the real
 * tenant schema and an "owner" admin user. Names start with "Test ", so every
 * database and role is t_test_... and TenantResources.cleanup() drops them.
 */
import { randomBytes } from "node:crypto";
import { createTenant, startProvisioning, type TenantActor } from "@/lib/tenants/service";
import { openTenantDatabase, type ReadyWorkspace } from "@/lib/workspace/context";
import { randomLabel, testIdentifiers, testTenantName } from "./tenant-resources";

export type ProvisionedTenant = {
  id: string;
  name: string;
  adminUsername: string;
  adminEmail: string;
  adminPassword: string;
};

/**
 * Creates and provisions an active tenant with known admin credentials.
 * `label` must be lower-case letters/digits (it becomes part of t_test_ names).
 */
export async function createProvisionedTenant(label: string, actor: TenantActor): Promise<ProvisionedTenant> {
  const token = randomLabel(6);
  const names = testIdentifiers(label);
  const input = {
    fullName: testTenantName(label),
    phone: "",
    username: `test-${label}-${token}`,
    email: `test-${label}-${token}@example.com`,
    masterPassword: `Mp-${randomBytes(12).toString("base64url")}`,
    databaseName: names.database,
    databaseUser: names.user,
    databasePassword: randomBytes(24).toString("base64url"),
    databasePort: "",
    subdomain: `test-${label}-${token}`,
    customDomain: "",
    loginMode: "manual",
    databaseCredentialMode: "manual",
    subdomainMode: "manual",
    databaseMode: "provisioned",
    profileImage: null,
  };
  const created = await createTenant(input, actor);
  if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created)}`);
  const outcome = await startProvisioning(created.tenantId, actor);
  if (outcome.status !== "succeeded") throw new Error(`provisioning failed: ${JSON.stringify(outcome)}`);
  return {
    id: created.tenantId,
    name: input.fullName,
    adminUsername: input.username,
    adminEmail: input.email,
    adminPassword: input.masterPassword,
  };
}

/** The "ready" workspace the guards would build for this tenant's host. */
export async function readyWorkspace(tenant: ProvisionedTenant): Promise<ReadyWorkspace> {
  return { state: "ready", tenant: { id: tenant.id, name: tenant.name }, db: await openTenantDatabase(tenant.id) };
}

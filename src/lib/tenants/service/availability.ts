import "server-only";
/**
 * Whether tenant names are still free (docs/tenant-management.md §8.1 step 4).
 *
 * These checks give a friendly answer up front; the unique indexes remain
 * the guarantee (a concurrent create is caught as a unique violation).
 */
import { getControlDb } from "@/lib/db/control";
import { databaseExists, roleExists } from "@/lib/provisioning";

export type NameKind =
  | "username"
  | "email"
  | "subdomain"
  | "customDomain"
  | "databaseName"
  | "databaseUser";

export type NameSet = Partial<Record<NameKind, string | null>>;

/**
 * The names already held by a tenant in the control plane, in one round trip.
 * A missing or null name is not checked. The subdomain label is also the
 * tenant's slug, so both columns are consulted.
 *
 * `excludeTenantId` leaves one tenant's own names out (an edit may keep or
 * reuse them); without it every tenant counts.
 */
export async function takenInControlPlane(
  names: NameSet,
  excludeTenantId: string | null = null,
): Promise<Set<NameKind>> {
  const subdomain = names.subdomain ?? null;
  // `IS DISTINCT FROM NULL` is true for every row, so no exclusion means all tenants.
  const other = excludeTenantId;
  const rows = await getControlDb().$queryRaw<Record<NameKind, boolean>[]>`
    SELECT
      EXISTS (SELECT 1 FROM tenants
              WHERE admin_username = ${names.username ?? null} AND id IS DISTINCT FROM ${other}::uuid) AS "username",
      EXISTS (SELECT 1 FROM tenants
              WHERE contact_email = ${names.email ?? null} AND id IS DISTINCT FROM ${other}::uuid) AS "email",
      (EXISTS (SELECT 1 FROM tenants WHERE slug = ${subdomain} AND id IS DISTINCT FROM ${other}::uuid)
        OR EXISTS (SELECT 1 FROM tenant_domains
                   WHERE type = 'subdomain' AND hostname = ${subdomain}
                     AND tenant_id IS DISTINCT FROM ${other}::uuid)) AS "subdomain",
      EXISTS (SELECT 1 FROM tenant_domains
              WHERE type = 'custom' AND hostname = ${names.customDomain ?? null}
                AND tenant_id IS DISTINCT FROM ${other}::uuid) AS "customDomain",
      EXISTS (SELECT 1 FROM tenants
              WHERE database_name = ${names.databaseName ?? null} AND id IS DISTINCT FROM ${other}::uuid) AS "databaseName",
      EXISTS (SELECT 1 FROM tenants
              WHERE database_user = ${names.databaseUser ?? null} AND id IS DISTINCT FROM ${other}::uuid) AS "databaseUser"`;
  const row = rows[0];
  const taken = new Set<NameKind>();
  if (!row) return taken;
  for (const kind of Object.keys(row) as NameKind[]) {
    if (row[kind] === true) taken.add(kind);
  }
  return taken;
}

/**
 * Whether the database or role already exists on the PostgreSQL server at
 * `port` (another application's, or a leftover). Throws a ProvisioningError
 * when the server cannot be asked.
 */
export async function takenOnServer(
  databaseName: string,
  databaseUser: string,
  port: number,
): Promise<{ databaseName: boolean; databaseUser: boolean }> {
  const [database, role] = await Promise.all([
    databaseExists(databaseName, port),
    roleExists(databaseUser, port),
  ]);
  return { databaseName: database, databaseUser: role };
}

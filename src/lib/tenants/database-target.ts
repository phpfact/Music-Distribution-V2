import "server-only";
import { getControlDb } from "../db/control";
import type { TenantDatabase } from "../db/tenant";
import { readSecret, SecretDecryptionError, SecretNotFoundError } from "../secrets";
import { UUID_PATTERN } from "@/lib/uuid";

export type TenantDatabaseConfigProblem =
  /** No tenant with this id. */
  | "tenant_not_found"
  /** Name, user, port or secret reference not recorded yet (e.g. before provisioning). */
  | "incomplete"
  /** The secret is missing, or cannot be decrypted with the configured key. */
  | "secret_unavailable";

/**
 * The tenant's database cannot be addressed. Names the tenant and the problem
 * only; never a password, secret or connection string.
 */
export class TenantDatabaseConfigError extends Error {
  constructor(
    readonly tenantId: string,
    readonly problem: TenantDatabaseConfigProblem,
    options?: { cause?: unknown },
  ) {
    super(`tenant ${tenantId}: no usable database configuration (${problem})`, options);
    this.name = "TenantDatabaseConfigError";
  }
}

/**
 * Description: Load where a tenant's data lives and its runtime login.
 * Input: The tenant id.
 * Output: Database, user, port and the decrypted password; throws
 *   TenantDatabaseConfigError (not found, incomplete, secret unavailable). The
 *   result holds the plaintext password: pass it straight to getTenantDb() and
 *   never return, log or serialize it.
 * Use case: Tenant admin updates and other tenant-database work.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function loadTenantDatabase(tenantId: string): Promise<TenantDatabase> {
  if (!UUID_PATTERN.test(tenantId)) {
    throw new TenantDatabaseConfigError(tenantId, "tenant_not_found");
  }
  const tenant = await getControlDb().tenant.findUnique({
    where: { id: tenantId },
    select: { databaseName: true, databaseUser: true, databasePort: true, databaseSecretRef: true },
  });
  if (!tenant) throw new TenantDatabaseConfigError(tenantId, "tenant_not_found");

  const { databaseName, databaseUser, databasePort, databaseSecretRef } = tenant;
  if (!databaseName || !databaseUser || databasePort === null || !databaseSecretRef) {
    throw new TenantDatabaseConfigError(tenantId, "incomplete");
  }

  let password: string;
  try {
    password = await readSecret(databaseSecretRef, "tenant_database_password");
  } catch (error) {
    if (error instanceof SecretNotFoundError || error instanceof SecretDecryptionError) {
      throw new TenantDatabaseConfigError(tenantId, "secret_unavailable", { cause: error });
    }
    throw error;
  }

  return { tenantId, database: databaseName, user: databaseUser, password, port: databasePort };
}

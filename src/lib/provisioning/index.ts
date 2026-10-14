import "server-only";
/**
 * Tenant provisioning (docs/tenant-management.md §6): creating or attaching a
 * tenant's database and login, installing its schema and admin account, and
 * the PostgreSQL helpers the tenant service needs for uniqueness checks and
 * credential changes. No UI imports; nothing here returns a secret.
 */
export {
  databaseExists,
  type DatabaseLogin,
  type LoginTestResult,
  roleExists,
  setRolePassword,
  testDatabaseLogin,
  withLoginClient,
} from "./admin";
export { ProvisioningError, type ProvisioningErrorCode, sqlState } from "./errors";
export { checkExistingDatabase, type DatabaseCheck } from "./existing-database";
export { latestTenantMigration } from "./migrations";
export {
  isProvisioningRunning,
  type ProvisioningActor,
  type ProvisioningOptions,
  type ProvisioningOutcome,
  runProvisioning,
} from "./runner";
export { provisioningPlan, type ProvisioningStep } from "./steps";

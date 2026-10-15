import "server-only";
/**
 * Tenant use cases (docs/tenant-management.md §8). Server-only and free of
 * Next.js imports, so they can be tested directly; the Server Actions in
 * src/app/platform/(console)/tenants/actions.ts wrap them. No result here
 * contains a secret, except the generated master password of an auto-mode
 * create, returned once.
 */
export type { DatabaseCheck } from "@/lib/provisioning";
export type { ServiceFailure, TenantActor } from "./common";
export {
  type ConnectionTestField,
  type ConnectionTestInput,
  type ConnectionTestResult,
  testDatabaseConnection,
} from "./connection";
export {
  type CreateTenantDeps,
  type CreateTenantField,
  type CreateTenantFieldErrors,
  type CreateTenantInput,
  type CreateTenantResult,
  type CredentialMode,
  type CredentialModes,
  createTenant,
  type DatabaseMode,
  startProvisioning,
} from "./create";
export {
  type CredentialResult,
  type MasterPasswordResetInput,
  type MasterPasswordResetResult,
  resetMasterPassword,
  rotateDatabasePassword,
  updateExistingDatabasePassword,
} from "./credentials";
export {
  type DomainCheckDeps,
  type DomainCheckResult,
  recheckSubdomain,
  verifyCustomDomain,
} from "./domains";
export {
  type LifecycleResult,
  reactivateTenant,
  retryProvisioning,
  suspendTenant,
} from "./lifecycle";
export { type PreviewResult, type PreviewValues, previewGeneratedValues } from "./preview";
export {
  type DatabaseState,
  getTenantDetails,
  getTenantSummary,
  listTenants,
  type ProvisioningStepState,
  type TenantDetails,
  type TenantHistoryAction,
  type TenantHistoryEntry,
  type TenantListPage,
  type TenantListRow,
  type TenantSummary,
} from "./queries";
export {
  getTenantForEdit,
  type ProfileImageChange,
  type TenantForEdit,
  type UpdateTenantDeps,
  type UpdateTenantField,
  type UpdateTenantFieldErrors,
  type UpdateTenantInput,
  type UpdateTenantResult,
  updateTenantProfile,
} from "./update";

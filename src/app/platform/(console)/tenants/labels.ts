/**
 * Display labels for tenant states, shared by every tenant screen. Plain data:
 * importable from server and client components and from tests. The types are
 * local string literals that mirror the Prisma enums, so this file stays free
 * of the generated client.
 */

export type TenantStatus =
  | "pending"
  | "provisioning"
  | "active"
  | "failed"
  | "suspended"
  | "deprovisioning";

export type ProvisioningStepName =
  | "create_database_user"
  | "create_database"
  | "check_database"
  | "grant_privileges"
  | "apply_migrations"
  | "create_initial_admin"
  | "register_domain"
  | "verify";

export type DomainStatus = "pending" | "active" | "failed";

// Worded for the owner, not the state machine: "provisioning" reads as "Setting up".
export const TENANT_STATUS_LABELS: Readonly<Record<TenantStatus, string>> = {
  pending: "Pending",
  provisioning: "Setting up",
  active: "Active",
  failed: "Setup failed",
  suspended: "Suspended",
  deprovisioning: "Removing",
};

export const PROVISIONING_STEP_LABELS: Readonly<Record<ProvisioningStepName, string>> = {
  create_database_user: "Create database user",
  create_database: "Create database",
  check_database: "Check existing database",
  grant_privileges: "Grant privileges",
  apply_migrations: "Install schema",
  create_initial_admin: "Create admin account",
  register_domain: "Register domain",
  verify: "Verify",
};

export const DOMAIN_STATUS_LABELS: Readonly<Record<DomainStatus, string>> = {
  pending: "Pending verification",
  active: "Active",
  failed: "Failed",
};

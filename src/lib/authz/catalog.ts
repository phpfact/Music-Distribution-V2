/**
 * The permission catalog of the three authorization domains
 * (.vibe/memory/role-privilege-management.md, "Permission catalog").
 *
 * This file is the single source of truth for every privilege that exists:
 *   - the server resolves effective privileges against it (src/lib/authz);
 *   - the migrations mirror it into `platform_permissions` (control plane) and
 *     `permissions` (every tenant database); tests keep both mirrors identical;
 *   - later, the role editors render it (labels and descriptions are display
 *     text only; the KEYS are the stable identifiers stored in the database).
 *
 * A key is `<domain>.<module>.<action>`. Every non-`view` privilege of a module
 * that has a `view` privilege requires that `view` privilege (`requires`), plus
 * the explicit dependencies of the spec.
 *
 * Client-safe: no `server-only`, no `node:` imports, no database access, so
 * client components may import the same catalog for the role editors.
 *
 * Adding a privilege: add it here AND in a new migration that upserts it into
 * both mirrors (the catalog ↔ database tests fail until both agree).
 */

// ---------------------------------------------------------------------------
// Domains and master roles

/** The three strictly isolated authorization domains. */
export const AUTHZ_DOMAINS = ["platform", "tenant", "customer"] as const;

/** One authorization domain: platform (control plane), tenant or customer (tenant database). */
export type AuthzDomain = (typeof AUTHZ_DOMAINS)[number];

/**
 * The protected `system_key` of each domain's master role. A master role is
 * recognised by this key only, never by its name.
 */
export const MASTER_SYSTEM_KEYS = {
  platform: "master_platform",
  tenant:   "master_tenant",
  customer: "master_customer",
} as const satisfies Record<AuthzDomain, string>;

/** A master role's system key. */
export type MasterSystemKey = (typeof MASTER_SYSTEM_KEYS)[AuthzDomain];

/** The display names the migrations give the master roles (names grant nothing). */
export const MASTER_ROLE_NAMES = {
  platform: "Master Platform",
  tenant:   "Master Tenant",
  customer: "Master Customer",
} as const satisfies Record<AuthzDomain, string>;

/**
 * The role `key` of the two tenant-database master roles. Master Tenant keeps
 * the key `owner` that provisioning has always written (existing data and the
 * provisioning upsert depend on it).
 */
export const TENANT_MASTER_ROLE_KEYS = {
  tenant:   "owner",
  customer: "master_customer",
} as const;

// ---------------------------------------------------------------------------
// Modules

/** One module of the catalog: a group of privileges switched on/off together. */
export type CatalogModule = {
  /** Stable identifier, `<domain>.<module>`. */
  readonly key: string;
  readonly domain: AuthzDomain;
  /** Display text only. */
  readonly label: string;
  /** Display text only. */
  readonly description: string;
  /** Core modules (roles, users, platform modules) can never be disabled. */
  readonly core: boolean;
  /** Display order inside its domain. */
  readonly sortOrder: number;
};

// The modules, in display order. Keys must never change once released.
const MODULES = [
  // Platform domain (control-plane database)
  { key: "platform.tenants", domain: "platform", label: "Tenant Management", description: "Tenant directory, tenant setup and tenant administration.", core: false, sortOrder: 100 },
  { key: "platform.tenant_registrations", domain: "platform", label: "Tenant Customer Registrations", description: "Customer registrations of every tenant and their customer accounts.", core: false, sortOrder: 200 },
  { key: "platform.tenant_modules", domain: "platform", label: "Tenant Module Access", description: "The tenant and customer panel modules available to each tenant.", core: false, sortOrder: 300 },
  { key: "platform.appearance", domain: "platform", label: "Platform Appearance", description: "The appearance applied to every Platform Owner.", core: false, sortOrder: 400 },
  { key: "platform.roles", domain: "platform", label: "Roles & Privileges", description: "Platform roles and the privileges they grant.", core: true, sortOrder: 500 },
  { key: "platform.users", domain: "platform", label: "Sub-Platform Owners", description: "The Platform Owner's team accounts.", core: true, sortOrder: 600 },
  { key: "platform.modules", domain: "platform", label: "Platform Modules", description: "The platform-wide switch of every platform module.", core: true, sortOrder: 700 },
  // Tenant domain (tenant database)
  { key: "tenant.registrations", domain: "tenant", label: "Customer Registrations", description: "Customer sign-up requests and customer accounts.", core: false, sortOrder: 100 },
  { key: "tenant.appearance", domain: "tenant", label: "Workspace Appearance", description: "The default appearance of the workspace.", core: false, sortOrder: 200 },
  { key: "tenant.roles", domain: "tenant", label: "Roles & Privileges", description: "Tenant roles and the privileges they grant.", core: true, sortOrder: 300 },
  { key: "tenant.users", domain: "tenant", label: "Sub-Tenants", description: "The tenant's team accounts.", core: true, sortOrder: 400 },
  // Customer domain (tenant database)
  { key: "customer.roles", domain: "customer", label: "Roles & Privileges", description: "Customer roles and the privileges they grant.", core: true, sortOrder: 100 },
  { key: "customer.sub_customers", domain: "customer", label: "Sub-Customers", description: "The customer's sub-customer accounts.", core: true, sortOrder: 200 },
] as const satisfies readonly CatalogModule[];

/** A module key of the catalog. */
export type ModuleKey = (typeof MODULES)[number]["key"];

// ---------------------------------------------------------------------------
// Permissions (privileges)

/** One privilege of the catalog. */
export type CatalogPermission = {
  /** Stable identifier, `<module key>.<action>`, stored in the database. */
  readonly key: PermissionKey;
  readonly module: ModuleKey;
  readonly domain: AuthzDomain;
  readonly action: string;
  /** Display text only. */
  readonly label: string;
  /** Display text only. */
  readonly description: string;
  /** Privileges that must also be granted whenever this one is. */
  readonly requires: readonly PermissionKey[];
  /** Display order inside its domain (module sort order + 10 per action). */
  readonly sortOrder: number;
};

// The shape every entry below must have (typed before PermissionKey exists).
type PermissionDefinition = {
  readonly key: string;
  readonly module: ModuleKey;
  readonly action: string;
  readonly label: string;
  readonly description: string;
  readonly requires: readonly string[];
  readonly sortOrder: number;
};

// The privileges, in display order. Keys must never change once released.
const PERMISSIONS = [
  // platform.tenants
  { key: "platform.tenants.view", module: "platform.tenants", action: "view", label: "View tenants", description: "Open the tenant directory, tenant details, summary counts and profile images.", requires: [], sortOrder: 110 },
  { key: "platform.tenants.create", module: "platform.tenants", action: "create", label: "Create tenants", description: "Use the create form, the value preview and the connection test, and create tenants.", requires: ["platform.tenants.view"], sortOrder: 120 },
  { key: "platform.tenants.edit", module: "platform.tenants", action: "edit", label: "Edit tenants", description: "Edit tenant details and domains and run domain checks.", requires: ["platform.tenants.view"], sortOrder: 130 },
  { key: "platform.tenants.suspend", module: "platform.tenants", action: "suspend", label: "Suspend and reactivate tenants", description: "Suspend a tenant and reactivate it again.", requires: ["platform.tenants.view"], sortOrder: 140 },
  { key: "platform.tenants.provision", module: "platform.tenants", action: "provision", label: "Retry tenant setup", description: "Retry the setup of a tenant whose provisioning failed.", requires: ["platform.tenants.view"], sortOrder: 150 },
  { key: "platform.tenants.credentials", module: "platform.tenants", action: "credentials", label: "Manage tenant credentials", description: "Reset the master password and rotate or update the database password.", requires: ["platform.tenants.view"], sortOrder: 160 },
  // platform.tenant_registrations
  { key: "platform.tenant_registrations.view", module: "platform.tenant_registrations", action: "view", label: "View customer registrations", description: "Open a tenant's customer registrations page and its counts.", requires: ["platform.tenants.view"], sortOrder: 210 },
  { key: "platform.tenant_registrations.review", module: "platform.tenant_registrations", action: "review", label: "Approve and reject registrations", description: "Approve or reject a tenant's customer registrations.", requires: ["platform.tenant_registrations.view"], sortOrder: 220 },
  { key: "platform.tenant_registrations.suspend", module: "platform.tenant_registrations", action: "suspend", label: "Suspend and reactivate customer accounts", description: "Suspend or reactivate approved customer accounts of a tenant.", requires: ["platform.tenant_registrations.view"], sortOrder: 230 },
  // platform.tenant_modules
  { key: "platform.tenant_modules.manage", module: "platform.tenant_modules", action: "manage", label: "Manage tenant modules", description: "Switch the tenant and customer panel modules of a tenant on or off.", requires: ["platform.tenants.view"], sortOrder: 310 },
  // platform.appearance
  { key: "platform.appearance.manage_global", module: "platform.appearance", action: "manage_global", label: "Manage global appearance", description: "Apply or reset the appearance for every Platform Owner.", requires: [], sortOrder: 410 },
  // platform.roles (core)
  { key: "platform.roles.view", module: "platform.roles", action: "view", label: "View roles", description: "Open the platform roles and their privileges.", requires: [], sortOrder: 510 },
  { key: "platform.roles.create", module: "platform.roles", action: "create", label: "Create roles", description: "Create platform roles.", requires: ["platform.roles.view"], sortOrder: 520 },
  { key: "platform.roles.edit", module: "platform.roles", action: "edit", label: "Edit roles", description: "Edit, disable and enable platform roles.", requires: ["platform.roles.view"], sortOrder: 530 },
  { key: "platform.roles.delete", module: "platform.roles", action: "delete", label: "Delete roles", description: "Delete platform roles.", requires: ["platform.roles.view"], sortOrder: 540 },
  // platform.users (core)
  { key: "platform.users.view", module: "platform.users", action: "view", label: "View Sub-Platform Owners", description: "Open the list of Sub-Platform Owners.", requires: [], sortOrder: 610 },
  { key: "platform.users.create", module: "platform.users", action: "create", label: "Create Sub-Platform Owners", description: "Create Sub-Platform Owner accounts.", requires: ["platform.users.view"], sortOrder: 620 },
  { key: "platform.users.edit", module: "platform.users", action: "edit", label: "Edit Sub-Platform Owners", description: "Change a Sub-Platform Owner's details, role or password.", requires: ["platform.users.view"], sortOrder: 630 },
  { key: "platform.users.suspend", module: "platform.users", action: "suspend", label: "Suspend and reactivate Sub-Platform Owners", description: "Suspend a Sub-Platform Owner and reactivate it again.", requires: ["platform.users.view"], sortOrder: 640 },
  // platform.modules (core)
  { key: "platform.modules.manage", module: "platform.modules", action: "manage", label: "Manage platform modules", description: "Switch platform modules on or off for everyone.", requires: [], sortOrder: 710 },
  // tenant.registrations
  { key: "tenant.registrations.view", module: "tenant.registrations", action: "view", label: "View customer registrations", description: "Open the customer registrations page and its counts.", requires: [], sortOrder: 110 },
  { key: "tenant.registrations.review", module: "tenant.registrations", action: "review", label: "Approve and reject registrations", description: "Approve or reject customer registrations.", requires: ["tenant.registrations.view"], sortOrder: 120 },
  { key: "tenant.registrations.suspend", module: "tenant.registrations", action: "suspend", label: "Suspend and reactivate customer accounts", description: "Suspend or reactivate approved customer accounts.", requires: ["tenant.registrations.view"], sortOrder: 130 },
  // tenant.appearance
  { key: "tenant.appearance.manage_workspace", module: "tenant.appearance", action: "manage_workspace", label: "Manage workspace appearance", description: "Apply or reset the workspace default appearance.", requires: [], sortOrder: 210 },
  // tenant.roles (core)
  { key: "tenant.roles.view", module: "tenant.roles", action: "view", label: "View roles", description: "Open the tenant roles and their privileges.", requires: [], sortOrder: 310 },
  { key: "tenant.roles.create", module: "tenant.roles", action: "create", label: "Create roles", description: "Create tenant roles.", requires: ["tenant.roles.view"], sortOrder: 320 },
  { key: "tenant.roles.edit", module: "tenant.roles", action: "edit", label: "Edit roles", description: "Edit, disable and enable tenant roles.", requires: ["tenant.roles.view"], sortOrder: 330 },
  { key: "tenant.roles.delete", module: "tenant.roles", action: "delete", label: "Delete roles", description: "Delete tenant roles.", requires: ["tenant.roles.view"], sortOrder: 340 },
  // tenant.users (core)
  { key: "tenant.users.view", module: "tenant.users", action: "view", label: "View Sub-Tenants", description: "Open the list of Sub-Tenants.", requires: [], sortOrder: 410 },
  { key: "tenant.users.create", module: "tenant.users", action: "create", label: "Create Sub-Tenants", description: "Create Sub-Tenant accounts.", requires: ["tenant.users.view"], sortOrder: 420 },
  { key: "tenant.users.edit", module: "tenant.users", action: "edit", label: "Edit Sub-Tenants", description: "Change a Sub-Tenant's details, role or password.", requires: ["tenant.users.view"], sortOrder: 430 },
  { key: "tenant.users.suspend", module: "tenant.users", action: "suspend", label: "Suspend and reactivate Sub-Tenants", description: "Suspend a Sub-Tenant and reactivate it again.", requires: ["tenant.users.view"], sortOrder: 440 },
  // customer.roles (core)
  { key: "customer.roles.view", module: "customer.roles", action: "view", label: "View roles", description: "Open the customer roles and their privileges.", requires: [], sortOrder: 110 },
  { key: "customer.roles.create", module: "customer.roles", action: "create", label: "Create roles", description: "Create customer roles.", requires: ["customer.roles.view"], sortOrder: 120 },
  { key: "customer.roles.edit", module: "customer.roles", action: "edit", label: "Edit roles", description: "Edit, disable and enable customer roles.", requires: ["customer.roles.view"], sortOrder: 130 },
  { key: "customer.roles.delete", module: "customer.roles", action: "delete", label: "Delete roles", description: "Delete customer roles.", requires: ["customer.roles.view"], sortOrder: 140 },
  // customer.sub_customers (core)
  { key: "customer.sub_customers.view", module: "customer.sub_customers", action: "view", label: "View Sub-Customers", description: "Open the list of Sub-Customers.", requires: [], sortOrder: 210 },
  { key: "customer.sub_customers.create", module: "customer.sub_customers", action: "create", label: "Create Sub-Customers", description: "Create Sub-Customer accounts.", requires: ["customer.sub_customers.view"], sortOrder: 220 },
  { key: "customer.sub_customers.edit", module: "customer.sub_customers", action: "edit", label: "Edit Sub-Customers", description: "Change a Sub-Customer's details, role or password.", requires: ["customer.sub_customers.view"], sortOrder: 230 },
  { key: "customer.sub_customers.suspend", module: "customer.sub_customers", action: "suspend", label: "Suspend and reactivate Sub-Customers", description: "Suspend a Sub-Customer and reactivate it again.", requires: ["customer.sub_customers.view"], sortOrder: 240 },
] as const satisfies readonly PermissionDefinition[];

/** Every privilege key of the catalog (all domains). */
export type PermissionKey = (typeof PERMISSIONS)[number]["key"];
/** The privilege keys of one domain. */
export type DomainPermissionKey<D extends AuthzDomain> = Extract<PermissionKey, `${D}.${string}`>;
/** Platform privileges (Platform Owner and Sub-Platform Owners). */
export type PlatformPermissionKey = DomainPermissionKey<"platform">;
/** Tenant privileges (Tenant and Sub-Tenants). */
export type TenantPermissionKey = DomainPermissionKey<"tenant">;
/** Customer privileges (Customer and Sub-Customers). */
export type CustomerPermissionKey = DomainPermissionKey<"customer">;

// ---------------------------------------------------------------------------
// Public, widened views of the catalog and lookup maps (built once)

/** Every module, in display order. */
export const CATALOG_MODULES: readonly CatalogModule[] = MODULES;

// Module by key: used to derive each privilege's domain and core flag.
const MODULE_BY_KEY = new Map<string, CatalogModule>(MODULES.map((module) => [module.key, module]));

/** Every privilege, in display order, with its domain filled in from its module. */
export const CATALOG_PERMISSIONS: readonly CatalogPermission[] = PERMISSIONS.map((permission) => ({
  key: permission.key,
  module: permission.module,
  // The module always exists: `module` is typed as ModuleKey above.
  domain: (MODULE_BY_KEY.get(permission.module) as CatalogModule).domain,
  action: permission.action,
  label: permission.label,
  description: permission.description,
  requires: permission.requires as readonly PermissionKey[],
  sortOrder: permission.sortOrder,
}));

// Privilege by key: the one lookup every helper below uses.
const PERMISSION_BY_KEY = new Map<string, CatalogPermission>(
  CATALOG_PERMISSIONS.map((permission) => [permission.key, permission]),
);

// ---------------------------------------------------------------------------
// Lookups

/**
 * Description: Find one module of the catalog.
 * Input: A module key (any string; untrusted values are fine).
 * Output: The module, or undefined for an unknown key.
 * Use case: Module settings screens and the resolver's core-module check.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function getModule(moduleKey: string): CatalogModule | undefined {
  return MODULE_BY_KEY.get(moduleKey);
}

/**
 * Description: Find one privilege of the catalog.
 * Input: A privilege key (any string; untrusted values are fine).
 * Output: The privilege, or undefined for an unknown key.
 * Use case: Validating role editor submissions; labels in audit views.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function getPermission(key: string): CatalogPermission | undefined {
  return PERMISSION_BY_KEY.get(key);
}

/**
 * Description: List the modules of one domain.
 * Input: The domain.
 * Output: Its modules in display order.
 * Use case: Module switches (platform kill switch, per-tenant switches) and role editors.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function modulesOfDomain(domain: AuthzDomain): CatalogModule[] {
  return CATALOG_MODULES.filter((module) => module.domain === domain);
}

/**
 * Description: List the privileges of one domain.
 * Input: The domain.
 * Output: Its privileges in display order.
 * Use case: Role editors; the resolver's master-role base set.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function permissionsOfDomain(domain: AuthzDomain): CatalogPermission[] {
  return CATALOG_PERMISSIONS.filter((permission) => permission.domain === domain);
}

/**
 * Description: List the privilege keys of one domain.
 * Input: The domain.
 * Output: Its keys in display order.
 * Use case: The resolver (a master role holds every key of its domain).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function permissionKeysOfDomain<D extends AuthzDomain>(domain: D): DomainPermissionKey<D>[] {
  return permissionsOfDomain(domain).map((permission) => permission.key as DomainPermissionKey<D>);
}

/**
 * Description: Name the module a privilege belongs to.
 * Input: A privilege key (any string).
 * Output: The module key, or null for an unknown privilege.
 * Use case: Removing the privileges of centrally disabled modules.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function moduleOfPermission(key: string): ModuleKey | null {
  return PERMISSION_BY_KEY.get(key)?.module ?? null;
}

/**
 * Description: Tell whether a module is a core module (can never be disabled).
 * Input: A module key (any string).
 * Output: True only for a known core module (roles, users/sub-users, platform modules).
 * Use case: The resolver ignores settings of core modules; module switches show them locked.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function isCoreModule(moduleKey: string): boolean {
  return MODULE_BY_KEY.get(moduleKey)?.core === true;
}

/**
 * Description: Tell whether a key is a privilege of the given domain.
 * Input: The domain and a key (any value; untrusted input is fine).
 * Output: True (and the key narrowed) only for a catalog privilege of that domain.
 *   Keys of another domain and unknown keys are false: they never grant anything.
 * Use case: Intersecting stored role privileges with the catalog; validating submissions.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function isKnownPermission<D extends AuthzDomain>(domain: D, key: unknown): key is DomainPermissionKey<D> {
  if (typeof key !== "string") return false;
  return PERMISSION_BY_KEY.get(key)?.domain === domain;
}

// ---------------------------------------------------------------------------
// Dependencies (`requires`)

/**
 * Description: Expand a set of privileges with everything they require.
 * Input: Privilege keys (unknown keys are ignored).
 * Output: The known keys plus every transitive `requires` dependency.
 * Use case: Role editors (ticking "Edit" also ticks "View").
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function dependencyClosure(keys: Iterable<string>): Set<PermissionKey> {
  const closure = new Set<PermissionKey>();
  // Step 1: start from the known keys only (unknown keys grant nothing).
  const pending: PermissionKey[] = [];
  for (const key of keys) {
    const permission = PERMISSION_BY_KEY.get(key);
    if (permission) pending.push(permission.key);
  }
  // Step 2: walk the `requires` edges until nothing new is added.
  while (pending.length > 0) {
    const key = pending.pop() as PermissionKey;
    if (closure.has(key)) continue;
    closure.add(key);
    for (const required of PERMISSION_BY_KEY.get(key)?.requires ?? []) pending.push(required);
  }
  return closure;
}

/** A privilege whose required privileges are not all selected. */
export type MissingDependency = { key: PermissionKey; missing: PermissionKey[] };

/** The outcome of validating a privilege selection for one domain. */
export type PermissionSelectionResult<D extends AuthzDomain> =
  | { ok: true; keys: DomainPermissionKey<D>[] }
  | { ok: false; unknown: string[]; missing: MissingDependency[] };

/**
 * Description: Validate a submitted privilege selection for one domain.
 * Input: The domain and the submitted keys (untrusted).
 * Output: ok with the de-duplicated keys in catalog order; or the keys that are
 *   unknown / of another domain, and the selected keys whose `requires`
 *   dependencies are missing. Never auto-adds anything (the caller decides).
 * Use case: Role create/edit services (the delegation ceiling is checked separately).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function validatePermissionSelection<D extends AuthzDomain>(
  domain: D,
  keys: readonly unknown[],
): PermissionSelectionResult<D> {
  // Step 1: split the submission into known keys of this domain and the rest.
  const selected = new Set<string>();
  const unknown: string[] = [];
  for (const key of keys) {
    if (isKnownPermission(domain, key)) selected.add(key);
    else unknown.push(String(key));
  }

  // Step 2: every selected key needs all of its direct requirements selected.
  const missing: MissingDependency[] = [];
  for (const key of selected) {
    const permission = PERMISSION_BY_KEY.get(key) as CatalogPermission;
    const absent     = permission.requires.filter((required) => !selected.has(required));
    if (absent.length > 0) missing.push({ key: permission.key, missing: absent });
  }

  // Step 3: valid only when nothing is unknown and nothing is missing.
  if (unknown.length > 0 || missing.length > 0) return { ok: false, unknown, missing };
  const ordered = permissionKeysOfDomain(domain).filter((key) => selected.has(key));
  return { ok: true, keys: ordered };
}

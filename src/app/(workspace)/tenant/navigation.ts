/**
 * The tenant staff area's navigation and its placeholder modules
 * (.vibe/memory/tenant-dashboard.md). The one place the sidebar, the page
 * titles and the "coming soon" pages read from.
 */
import type { DashboardConfig, DashboardNavGroup, DashboardNavItem } from "@/components/dashboard/types";
import type { DashboardIconName } from "@/components/dashboard/icons";
import { NO_ACTIVE_ROLE_LABEL } from "@/components/shared/access-denied";
import type { TenantPermissionKey } from "@/lib/authz/catalog";

export const TENANT_BASE_PATH          = "/tenant";
export const TENANT_DASHBOARD_PATH     = "/tenant/dashboard";
export const TENANT_REGISTRATIONS_PATH = "/tenant/registrations";
export const TENANT_APPEARANCE_PATH    = "/tenant/settings/appearance";
export const TENANT_USERS_PATH         = "/tenant/users";
export const TENANT_ROLES_PATH         = "/tenant/roles";
export const TENANT_CUSTOMERS_PATH     = "/tenant/customers";
/** The tenant area's sidebar preference cookie (sent only to /tenant). */
export const TENANT_SIDEBAR_COOKIE = { name: "md_tenant_sidebar", path: "/tenant" } as const;

type PlannedModule = { title: string; description: string; icon: DashboardIconName; group: "Catalog" | "Business" };

/**
 * Modules that are not built yet: each has a route that shows an honest
 * "coming soon" page, never fake data (owner decision 2026-10-15).
 * "customers" left this list on 2026-10-17: it is a real module now
 * (/tenant/customers, .vibe/memory/customer-management.md).
 */
export const TENANT_PLANNED_MODULES = {
  releases:     { title: "Releases",     description: "Review and process the audio and video releases your customers submit.", icon: "disc", group: "Catalog" },
  artists:      { title: "Artists",      description: "The artists behind your customers’ releases.", icon: "mic-vocal", group: "Catalog" },
  labels:       { title: "Labels",       description: "The labels your customers release music under.", icon: "tag", group: "Catalog" },
  distribution: { title: "Distribution", description: "Deliver approved releases to stores and streaming services.", icon: "send", group: "Business" },
  analytics:    { title: "Analytics",    description: "Streams, downloads and audience insights across your catalogue.", icon: "chart-column", group: "Business" },
  royalties:    { title: "Royalties",    description: "Earnings, statements and payouts for your customers.", icon: "banknote", group: "Business" },
} as const satisfies Record<string, PlannedModule>;

export type TenantPlannedModule = keyof typeof TENANT_PLANNED_MODULES;

/**
 * Description: Look up a placeholder module by its URL segment.
 * Input: The `[module]` segment (anyone can type it).
 * Output: The module, or null for anything that is not a planned module.
 * Use case: /tenant/[module] (unknown segments answer 404).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function findTenantModule(segment: string): PlannedModule | null {
  return Object.hasOwn(TENANT_PLANNED_MODULES, segment)
    ? TENANT_PLANNED_MODULES[segment as TenantPlannedModule]
    : null;
}

/**
 * Description: Build the tenant area's sidebar items of one group.
 * Input: The group name.
 * Output: The planned modules of that group as "soon" links.
 * Use case: tenantDashboardConfig.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function plannedItems(group: PlannedModule["group"]): DashboardNavItem[] {
  return Object.entries(TENANT_PLANNED_MODULES)
    .filter(([, module]) => module.group === group)
    .map(([segment, module]) => ({
      title: module.title,
      href: `${TENANT_BASE_PATH}/${segment}`,
      icon: module.icon,
      soon: true,
    }));
}

/**
 * The real (built) Business links and the privilege each needs
 * (.vibe/memory/customer-management.md). They come before the planned
 * Business modules.
 */
const BUSINESS_ITEMS: readonly (DashboardNavItem & { permission: TenantPermissionKey })[] = [
  { title: "Customers", href: TENANT_CUSTOMERS_PATH, icon: "users", permission: "tenant.customers.view" },
];

/**
 * The "Access control" links and the privilege each needs
 * (.vibe/memory/role-privilege-management.md, "Navigation"). Their pages are
 * built by the role and sub-user management tasks.
 */
const ACCESS_CONTROL_ITEMS: readonly (DashboardNavItem & { permission: TenantPermissionKey })[] = [
  { title: "Sub-Tenants", href: TENANT_USERS_PATH, icon: "users", permission: "tenant.users.view" },
  { title: "Roles & Privileges", href: TENANT_ROLES_PATH, icon: "shield-check", permission: "tenant.roles.view" },
];

/**
 * Description: Build the tenant area's dashboard configuration for the signed-in user.
 * Input: The tenant's name, the user (name, username, email, role name) and the
 *   user's effective tenant privileges (role state + can()).
 * Output: Brand, navigation filtered by privilege (Registrations and its quick
 *   action with tenant.registrations.view; Business → Customers with
 *   tenant.customers.view; "Access control" with Sub-Tenants
 *   (tenant.users.view) and Roles & Privileges (tenant.roles.view); the planned
 *   Catalog/Business modules are ungated), Appearance link and the account-menu
 *   data (role name, or "No active role").
 * Use case: src/app/(workspace)/tenant/layout.tsx. Every page and action checks
 *   its privilege again on the server; hiding a link is never the protection.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-17
 */
export function tenantDashboardConfig(
  tenantName: string,
  user: { name: string; username: string | null; email: string; role: { name: string } | null },
  authz: { roleState: string; can: (key: TenantPermissionKey) => boolean },
): DashboardConfig {
  // Step 1: the main links (Dashboard always; Registrations by privilege).
  const canSeeRegistrations = authz.can("tenant.registrations.view");
  const navMain: DashboardNavItem[] = [{ title: "Dashboard", href: TENANT_DASHBOARD_PATH, icon: "layout-dashboard" }];
  if (canSeeRegistrations) navMain.push({ title: "Registrations", href: TENANT_REGISTRATIONS_PATH, icon: "clipboard-check" });

  // Step 2: the groups; the built Business links and the access-control group
  // appear only with their privileges.
  const business = BUSINESS_ITEMS.filter((item) => authz.can(item.permission)).map(
    ({ title, href, icon }) => ({ title, href, icon }),
  );
  const accessControl = ACCESS_CONTROL_ITEMS.filter((item) => authz.can(item.permission)).map(
    ({ title, href, icon }) => ({ title, href, icon }),
  );
  const navGroups: DashboardNavGroup[] = [
    { label: "Catalog", items: plannedItems("Catalog") },
    { label: "Business", items: [...business, ...plannedItems("Business")] },
  ];
  if (accessControl.length > 0) navGroups.push({ label: "Access control", items: accessControl });

  // Step 3: the account menu names the role (display only).
  const roleLabel = authz.roleState === "active" && user.role ? user.role.name : NO_ACTIVE_ROLE_LABEL;

  return {
    brand: { name: tenantName, subtitle: "Tenant workspace", href: TENANT_DASHBOARD_PATH },
    quickAction: canSeeRegistrations
      ? { title: "Review registrations", href: `${TENANT_REGISTRATIONS_PATH}?status=pending`, icon: "clipboard-check" }
      : undefined,
    navMain,
    navGroups,
    navSecondary: [{ title: "Appearance", href: TENANT_APPEARANCE_PATH, icon: "palette" }],
    user: {
      name: user.name,
      roleLabel,
      username: user.username,
      email: user.email,
    },
    appearanceHref: TENANT_APPEARANCE_PATH,
  };
}

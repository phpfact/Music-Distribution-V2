/**
 * The customer area's navigation and its placeholder modules
 * (.vibe/memory/customer-dashboard.md). Separate from the tenant area's
 * navigation by design (owner decision 2026-10-15).
 */
import type { DashboardIconName } from "@/components/dashboard/icons";
import type { DashboardConfig, DashboardNavGroup, DashboardNavItem } from "@/components/dashboard/types";
import { NO_ACTIVE_ROLE_LABEL } from "@/components/shared/access-denied";
import type { CustomerPermissionKey } from "@/lib/authz/catalog";
import { accountTypeLabel, type AccountType } from "@/lib/workspace/rules";

export const CUSTOMER_BASE_PATH          = "/customer";
export const CUSTOMER_DASHBOARD_PATH     = "/customer/dashboard";
export const CUSTOMER_APPEARANCE_PATH    = "/customer/settings/appearance";
export const CUSTOMER_SUB_CUSTOMERS_PATH = "/customer/sub-customers";
export const CUSTOMER_ROLES_PATH         = "/customer/roles";
/** The customer area's sidebar preference cookie (sent only to /customer). */
export const CUSTOMER_SIDEBAR_COOKIE = { name: "md_customer_sidebar", path: "/customer" } as const;

type PlannedModule = { title: string; description: string; icon: DashboardIconName; group: "Music" | "Earnings" };

/** Modules that are not built yet: honest "coming soon" pages, never fake data. */
export const CUSTOMER_PLANNED_MODULES = {
  releases:  { title: "My Releases", description: "Create and submit your singles, EPs and albums for distribution.", icon: "disc", group: "Music" },
  artists:   { title: "Artists", description: "The artist profiles you release music for.", icon: "mic-vocal", group: "Music" },
  labels:    { title: "Labels", description: "The labels you release music under.", icon: "tag", group: "Music" },
  royalties: { title: "Royalties", description: "Your earnings and statements per release and store.", icon: "banknote", group: "Earnings" },
  payouts:   { title: "Payouts", description: "Withdrawals of your earnings to your account.", icon: "credit-card", group: "Earnings" },
} as const satisfies Record<string, PlannedModule>;

export type CustomerPlannedModule = keyof typeof CUSTOMER_PLANNED_MODULES;

/**
 * Description: Look up a placeholder module by its URL segment.
 * Input: The `[module]` segment (anyone can type it).
 * Output: The module, or null for anything that is not a planned module.
 * Use case: /customer/[module] (unknown segments answer 404).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function findCustomerModule(segment: string): PlannedModule | null {
  return Object.hasOwn(CUSTOMER_PLANNED_MODULES, segment)
    ? CUSTOMER_PLANNED_MODULES[segment as CustomerPlannedModule]
    : null;
}

/**
 * Description: Build the customer area's sidebar items of one group.
 * Input: The group name.
 * Output: The planned modules of that group as "soon" links.
 * Use case: customerDashboardConfig.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function plannedItems(group: PlannedModule["group"]): DashboardNavItem[] {
  return Object.entries(CUSTOMER_PLANNED_MODULES)
    .filter(([, module]) => module.group === group)
    .map(([segment, module]) => ({
      title: module.title,
      href: `${CUSTOMER_BASE_PATH}/${segment}`,
      icon: module.icon,
      soon: true,
    }));
}

/**
 * The "Account" links and the privilege each needs
 * (.vibe/memory/role-privilege-management.md, "Navigation"). Their pages are
 * built by the role and sub-customer management tasks.
 */
const ACCOUNT_ITEMS: readonly (DashboardNavItem & { permission: CustomerPermissionKey })[] = [
  { title: "Sub-Customers", href: CUSTOMER_SUB_CUSTOMERS_PATH, icon: "users", permission: "customer.sub_customers.view" },
  { title: "Roles & Privileges", href: CUSTOMER_ROLES_PATH, icon: "shield-check", permission: "customer.roles.view" },
];

/**
 * Description: Build the customer area's dashboard configuration.
 * Input: The tenant's name, the signed-in customer user (with role name and
 *   account type) and the user's effective customer privileges.
 * Output: Brand ("Customer portal"), navigation filtered by privilege (an
 *   "Account" group with Sub-Customers and Roles & Privileges; the planned
 *   modules are ungated), Appearance link and account-menu data (role label =
 *   "<role name> · <account type>", or "No active role · <account type>").
 * Use case: src/app/(workspace)/customer/(portal)/layout.tsx. Every page and
 *   action checks its privilege again; hiding a link is never the protection.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function customerDashboardConfig(
  tenantName: string,
  user: {
    name: string;
    username: string | null;
    email: string;
    role: { name: string } | null;
    customer: { type: AccountType };
  },
  authz: { roleState: string; can: (key: CustomerPermissionKey) => boolean },
): DashboardConfig {
  // Step 1: the groups; the account group appears only with at least one link.
  const account = ACCOUNT_ITEMS.filter((item) => authz.can(item.permission)).map(
    ({ title, href, icon }) => ({ title, href, icon }),
  );
  const navGroups: DashboardNavGroup[] = [
    { label: "Music", items: plannedItems("Music") },
    { label: "Earnings", items: plannedItems("Earnings") },
  ];
  if (account.length > 0) navGroups.push({ label: "Account", items: account });

  // Step 2: the account menu names the role (display only) and the account type.
  const roleName = authz.roleState === "active" && user.role ? user.role.name : NO_ACTIVE_ROLE_LABEL;

  return {
    brand: { name: tenantName, subtitle: "Customer portal", href: CUSTOMER_DASHBOARD_PATH },
    navMain: [{ title: "Dashboard", href: CUSTOMER_DASHBOARD_PATH, icon: "layout-dashboard" }],
    navGroups,
    navSecondary: [{ title: "Appearance", href: CUSTOMER_APPEARANCE_PATH, icon: "palette" }],
    user: {
      name: user.name,
      roleLabel: `${roleName} · ${accountTypeLabel(user.customer.type)}`,
      username: user.username,
      email: user.email,
    },
    appearanceHref: CUSTOMER_APPEARANCE_PATH,
  };
}

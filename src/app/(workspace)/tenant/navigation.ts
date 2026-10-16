/**
 * The tenant staff area's navigation and its placeholder modules
 * (.vibe/memory/tenant-dashboard.md). The one place the sidebar, the page
 * titles and the "coming soon" pages read from.
 */
import type { DashboardConfig, DashboardNavItem } from "@/components/dashboard/types";
import type { DashboardIconName } from "@/components/dashboard/icons";

export const TENANT_BASE_PATH          = "/tenant";
export const TENANT_DASHBOARD_PATH     = "/tenant/dashboard";
export const TENANT_REGISTRATIONS_PATH = "/tenant/registrations";
export const TENANT_APPEARANCE_PATH    = "/tenant/settings/appearance";
/** The tenant area's sidebar preference cookie (sent only to /tenant). */
export const TENANT_SIDEBAR_COOKIE = { name: "md_tenant_sidebar", path: "/tenant" } as const;

type PlannedModule = { title: string; description: string; icon: DashboardIconName; group: "Catalog" | "Business" };

/**
 * Modules that are not built yet: each has a route that shows an honest
 * "coming soon" page, never fake data (owner decision 2026-10-15).
 */
export const TENANT_PLANNED_MODULES = {
  releases:     { title: "Releases",     description: "Review and process the audio and video releases your customers submit.", icon: "disc", group: "Catalog" },
  artists:      { title: "Artists",      description: "The artists behind your customers’ releases.", icon: "mic-vocal", group: "Catalog" },
  labels:       { title: "Labels",       description: "The labels your customers release music under.", icon: "tag", group: "Catalog" },
  customers:    { title: "Customers",    description: "Manage your artists, labels and white-label partners.", icon: "users", group: "Business" },
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
 * Description: Build the tenant area's dashboard configuration for the signed-in user.
 * Input: The tenant's name and the user (name, username, email, owner flag).
 * Output: Brand, navigation (Registrations and the quick action only for the
 *   owner), Appearance link and the account-menu data.
 * Use case: src/app/(workspace)/tenant/layout.tsx. The server checks the owner
 *   role again on every owner-only page and action; hiding a link is never the protection.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function tenantDashboardConfig(
  tenantName: string,
  user: { name: string; username: string | null; email: string; isOwner: boolean },
): DashboardConfig {
  const navMain: DashboardNavItem[] = [{ title: "Dashboard", href: TENANT_DASHBOARD_PATH, icon: "layout-dashboard" }];
  if (user.isOwner) navMain.push({ title: "Registrations", href: TENANT_REGISTRATIONS_PATH, icon: "clipboard-check" });

  return {
    brand: { name: tenantName, subtitle: "Tenant workspace", href: TENANT_DASHBOARD_PATH },
    quickAction: user.isOwner
      ? { title: "Review registrations", href: `${TENANT_REGISTRATIONS_PATH}?status=pending`, icon: "clipboard-check" }
      : undefined,
    navMain,
    navGroups: [
      { label: "Catalog", items: plannedItems("Catalog") },
      { label: "Business", items: plannedItems("Business") },
    ],
    navSecondary: [{ title: "Appearance", href: TENANT_APPEARANCE_PATH, icon: "palette" }],
    user: {
      name: user.name,
      roleLabel: user.isOwner ? "Tenant administrator" : "Staff",
      username: user.username,
      email: user.email,
    },
    appearanceHref: TENANT_APPEARANCE_PATH,
  };
}

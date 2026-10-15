import type { IconName } from "./_components/icons";

/**
 * The single description of the platform console's navigation. The sidebar,
 * the top bar title, the dashboard's quick access, the placeholder pages and
 * their metadata all read from here. No "use client": imported on both sides.
 */

export type PlatformNavId =
  | "dashboard"
  | "tenants"
  | "roles"
  | "subscriptions"
  | "settings"
  | "support";

export type PlatformNavItem = {
  id: PlatformNavId;
  label: string;
  href: string;
  icon: IconName;
  description: string;
  /** "planned": the route exists but only shows a coming-soon notice. */
  status: "available" | "planned";
  children?: readonly { label: string; href: string; icon: IconName }[];
};

export type PlatformNavSection = {
  id: string;
  label: string;
  items: readonly PlatformNavItem[];
};

export const PLATFORM_NAV_SECTIONS: readonly PlatformNavSection[] = [
  {
    id: "overview",
    label: "Overview",
    items: [
      {
        id: "dashboard",
        label: "Dashboard",
        href: "/platform/dashboard",
        icon: "layout-grid",
        description: "Overview of the platform.",
        status: "available",
      },
    ],
  },
  {
    id: "platform-management",
    label: "Platform management",
    items: [
      {
        id: "tenants",
        label: "Tenant Management",
        href: "/platform/tenants",
        icon: "building-2",
        description: "Manage the tenants registered on the platform.",
        status: "available",
      },
      {
        id: "roles",
        label: "Roles Management",
        href: "/platform/roles",
        icon: "shield-check",
        description: "Manage platform-level roles and permissions.",
        status: "planned",
      },
      {
        id: "subscriptions",
        label: "Subscription & Plans",
        href: "/platform/subscriptions",
        icon: "credit-card",
        description: "Manage subscription plans and tenant subscriptions.",
        status: "planned",
      },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [
      {
        id: "settings",
        label: "Settings",
        href: "/platform/settings",
        icon: "settings",
        description: "Personalize your workspace and manage platform appearance.",
        status: "available",
        children: [{ label: "Appearance", href: "/platform/settings/appearance", icon: "sun" }],
      },
      {
        id: "support",
        label: "Support",
        href: "/platform/support",
        icon: "life-buoy",
        description: "Manage support requests and assistance.",
        status: "planned",
      },
    ],
  },
];

/** Every item, in navigation order. */
export const PLATFORM_NAV_ITEMS: readonly PlatformNavItem[] = PLATFORM_NAV_SECTIONS.flatMap(
  (section) => section.items,
);

/**
 * Description: Look up one navigation item by id.
 * Input: The navigation id.
 * Output: The item (label, href, icon, description, status); throws only if an id
 *   has no entry (unreachable).
 * Use case: Sidebar, top bar, dashboard and planned pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function getNavItem(id: PlatformNavId): PlatformNavItem {
  const item = PLATFORM_NAV_ITEMS.find((candidate) => candidate.id === id);
  // Unreachable while every id has an entry above.
  if (!item) throw new Error(`no navigation item "${id}"`);
  return item;
}

/**
 * Description: Treat a path with and without a trailing slash as the same page.
 * Input: A pathname.
 * Output: The pathname without trailing slashes ("/" for the root).
 * Use case: isNavItemActive.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function normalizePathname(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * Description: Tell whether a navigation item belongs to the current page.
 * Input: The item and the current pathname.
 * Output: True on the item's page and any page below it (whole segments only, so
 *   "/platform/tenantsx" does not count).
 * Use case: Sidebar highlighting.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function isNavItemActive(item: PlatformNavItem, pathname: string): boolean {
  const path = normalizePathname(pathname);
  return path === item.href || path.startsWith(`${item.href}/`);
}

/**
 * Description: Find the navigation item the current page belongs to.
 * Input: The current pathname.
 * Output: The most specific matching item, or undefined.
 * Use case: Top bar breadcrumb.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function findActiveNavItem(pathname: string): PlatformNavItem | undefined {
  let active: PlatformNavItem | undefined;
  for (const item of PLATFORM_NAV_ITEMS) {
    if (!isNavItemActive(item, pathname)) continue;
    if (!active || item.href.length > active.href.length) active = item;
  }
  return active;
}

import type { PlatformPermissionKey } from "@/lib/authz/catalog";
import type { IconName } from "./_components/icons";

/**
 * The single description of the platform console's navigation. The sidebar,
 * the top bar title, the dashboard's quick access, the placeholder pages and
 * their metadata all read from here. No "use client": imported on both sides.
 *
 * An item (or child) with a `permission` is shown only to owners whose
 * CURRENT effective privileges include it (.vibe/memory/role-privilege-management.md,
 * "Navigation"); items without one are shown to every signed-in owner. Hiding
 * is a convenience only: every page and action checks its privilege itself.
 */

export type PlatformNavId =
  | "dashboard"
  | "tenants"
  | "roles"
  | "users"
  | "subscriptions"
  | "settings"
  | "support";

/** A link below a navigation item (e.g. Settings → Appearance). */
export type PlatformNavChild = {
  label: string;
  href: string;
  icon: IconName;
  /** The privilege needed to see the link; absent = every signed-in owner. */
  permission?: PlatformPermissionKey;
};

export type PlatformNavItem = {
  id: PlatformNavId;
  label: string;
  href: string;
  icon: IconName;
  description: string;
  /** "planned": the route exists but only shows a coming-soon notice. */
  status: "available" | "planned";
  /** The privilege needed to see the item; absent = every signed-in owner. */
  permission?: PlatformPermissionKey;
  children?: readonly PlatformNavChild[];
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
        permission: "platform.tenants.view",
      },
      {
        id: "roles",
        label: "Roles & Privileges",
        href: "/platform/roles",
        icon: "shield-check",
        description: "Manage platform roles and the privileges they grant.",
        status: "available",
        permission: "platform.roles.view",
      },
      {
        id: "users",
        label: "Sub-Platform Owners",
        href: "/platform/users",
        icon: "user",
        description: "Manage the owners who help run the platform and their roles.",
        status: "available",
        permission: "platform.users.view",
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
        children: [
          { label: "Appearance", href: "/platform/settings/appearance", icon: "sun" },
          { label: "Modules", href: "/platform/settings/modules", icon: "layout-grid", permission: "platform.modules.manage" },
        ],
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
 * Description: Tell whether an item or child may be shown to an owner.
 * Input: The entry (its optional permission) and the owner's granted privilege keys.
 * Output: True when the entry needs no privilege or the keys include it.
 * Use case: filterNavSections (sidebar, top bar, dashboard quick access).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function canSeeNavEntry(entry: { permission?: PlatformPermissionKey }, permissions: readonly string[]): boolean {
  return entry.permission === undefined || permissions.includes(entry.permission);
}

/**
 * Description: Keep only the navigation an owner may see.
 * Input: The owner's granted privilege keys (serializable list from the server).
 * Output: The sections with the visible items and visible children only;
 *   sections left without items are dropped.
 * Use case: The console shell (sidebar and top bar) and the dashboard's quick
 *   access (.vibe/memory/role-privilege-management.md, "Navigation").
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function filterNavSections(permissions: readonly string[]): PlatformNavSection[] {
  return PLATFORM_NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items
      .filter((item) => canSeeNavEntry(item, permissions))
      .map((item) =>
        item.children ? { ...item, children: item.children.filter((child) => canSeeNavEntry(child, permissions)) } : item,
      ),
  })).filter((section) => section.items.length > 0);
}

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
 * Input: The current pathname and, optionally, the items to search (default:
 *   every item; the top bar passes only the owner's visible items).
 * Output: The most specific matching item, or undefined.
 * Use case: Top bar breadcrumb.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
export function findActiveNavItem(
  pathname: string,
  items: readonly PlatformNavItem[] = PLATFORM_NAV_ITEMS,
): PlatformNavItem | undefined {
  let active: PlatformNavItem | undefined;
  for (const item of items) {
    if (!isNavItemActive(item, pathname)) continue;
    if (!active || item.href.length > active.href.length) active = item;
  }
  return active;
}

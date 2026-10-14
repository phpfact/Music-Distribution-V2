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
        description: "Configure platform-level settings.",
        status: "planned",
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

export function getNavItem(id: PlatformNavId): PlatformNavItem {
  const item = PLATFORM_NAV_ITEMS.find((candidate) => candidate.id === id);
  // Unreachable while every id has an entry above.
  if (!item) throw new Error(`no navigation item "${id}"`);
  return item;
}

/** "/platform/tenants/" and "/platform/tenants" are the same page. */
function normalizePathname(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * True on the item's own page and on any page below it. Matched on whole
 * segments, so "/platform/tenantsx" does not count as "/platform/tenants".
 */
export function isNavItemActive(item: PlatformNavItem, pathname: string): boolean {
  const path = normalizePathname(pathname);
  return path === item.href || path.startsWith(`${item.href}/`);
}

/** The item the pathname belongs to; the most specific one if several match. */
export function findActiveNavItem(pathname: string): PlatformNavItem | undefined {
  let active: PlatformNavItem | undefined;
  for (const item of PLATFORM_NAV_ITEMS) {
    if (!isNavItemActive(item, pathname)) continue;
    if (!active || item.href.length > active.href.length) active = item;
  }
  return active;
}

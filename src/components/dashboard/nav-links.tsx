"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentPropsWithoutRef } from "react";
import { Badge } from "@/components/ui/badge";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { DashboardIcon } from "./icons";
import type { DashboardNavItem, DashboardQuickAction } from "./types";

/**
 * Description: Tell whether a navigation link belongs to the current page.
 * Input: The current pathname and the link's href (query strings ignored).
 * Output: True on the link's page and any page below it (whole segments only).
 * Use case: Active highlighting in every navigation list and the page title.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function isActivePath(pathname: string, href: string): boolean {
  const path   = pathname.replace(/\/+$/, "") || "/";
  const target = href.split("?")[0]?.replace(/\/+$/, "") || "/";
  return path === target || path.startsWith(`${target}/`);
}

/**
 * Description: Render one sidebar link (icon, title, optional badge or "Soon").
 * Input: The item and whether it is the current page.
 * Output: A SidebarMenuItem whose button is a Next Link; it closes the mobile
 *   sheet on navigation and shows a tooltip while the sidebar is collapsed.
 * Use case: NavMain, NavGroup and NavSecondary.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function NavLink({ item, active }: { item: DashboardNavItem; active: boolean }) {
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
        <Link href={item.href} aria-current={active ? "page" : undefined} onClick={() => setOpenMobile(false)}>
          <DashboardIcon name={item.icon} />
          <span>
            {item.title}
            {item.soon ? <span className="sr-only"> (coming soon)</span> : null}
          </span>
        </Link>
      </SidebarMenuButton>
      {item.badge && item.badge > 0 ? (
        <SidebarMenuBadge aria-label={`${item.badge} waiting`}>{item.badge}</SidebarMenuBadge>
      ) : item.soon ? (
        <SidebarMenuBadge aria-hidden="true">
          <Badge variant="secondary" className="h-4 rounded px-1 text-[9px] font-medium text-muted-foreground">
            Soon
          </Badge>
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
}

/**
 * Description: Render the main navigation, with the block's prominent quick action.
 * Input: The items and an optional real quick action.
 * Output: The first sidebar group (dashboard-01's NavMain).
 * Use case: AppSidebar.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function NavMain({ items, quickAction }: { items: readonly DashboardNavItem[]; quickAction?: DashboardQuickAction }) {
  const pathname          = usePathname();
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        {quickAction ? (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                tooltip={quickAction.title}
                className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
              >
                <Link href={quickAction.href} onClick={() => setOpenMobile(false)}>
                  <DashboardIcon name={quickAction.icon} />
                  <span>{quickAction.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        ) : null}
        <SidebarMenu>
          {items.map((item) => (
            <NavLink key={item.href} item={item} active={isActivePath(pathname, item.href)} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/**
 * Description: Render a labelled group of links (dashboard-01's "Documents" group).
 * Input: The group label and its items.
 * Output: A sidebar group (hidden while collapsed to icons, like the block).
 * Use case: AppSidebar ("Catalog", "Business" ...).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function NavGroup({ label, items }: { label: string; items: readonly DashboardNavItem[] }) {
  const pathname = usePathname();

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <NavLink key={item.href} item={item} active={isActivePath(pathname, item.href)} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

/**
 * Description: Render the secondary links at the bottom of the sidebar content.
 * Input: The items and the group's div props (e.g. "mt-auto").
 * Output: A sidebar group (dashboard-01's NavSecondary).
 * Use case: AppSidebar (Appearance).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function NavSecondary({
  items,
  ...props
}: { items: readonly DashboardNavItem[] } & ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const pathname = usePathname();

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <NavLink key={item.href} item={item} active={isActivePath(pathname, item.href)} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

"use client";

import { AudioLines } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { NavGroup, NavMain, NavSecondary } from "./nav-links";
import { NavUser } from "./nav-user";
import type { DashboardConfig } from "./types";

type AppSidebarProps = ComponentProps<typeof Sidebar> & {
  config: DashboardConfig;
  logoutAction: () => Promise<void>;
};

/**
 * Description: Render the dashboard sidebar (dashboard-01's AppSidebar).
 * Input: The area's configuration (brand, quick action, navigation, user,
 *   Appearance link), its sign-out action and the Sidebar props (variant).
 * Output: Header with the tenant's brand, main navigation, labelled groups,
 *   secondary links pushed to the bottom and the account menu in the footer.
 * Use case: DashboardShell of the tenant and customer areas.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function AppSidebar({ config, logoutAction, ...props }: AppSidebarProps) {
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" className="data-[slot=sidebar-menu-button]:p-1.5!">
              <Link href={config.brand.href} onClick={() => setOpenMobile(false)}>
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <AudioLines aria-hidden="true" className="size-4" />
                </span>
                <span className="grid min-w-0 flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold">{config.brand.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{config.brand.subtitle}</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={config.navMain} quickAction={config.quickAction} />
        {config.navGroups.map((group) => (
          <NavGroup key={group.label} label={group.label} items={group.items} />
        ))}
        <NavSecondary items={config.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={config.user} appearanceHref={config.appearanceHref} logoutAction={logoutAction} />
      </SidebarFooter>
    </Sidebar>
  );
}

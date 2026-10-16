"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { isActivePath } from "./nav-links";
import type { DashboardConfig } from "./types";

type SiteHeaderProps = {
  config: DashboardConfig;
  /** Controls on the right (e.g. the theme switch). */
  actions?: ReactNode;
};

/**
 * Description: Find the title of the current page from the navigation.
 * Input: The current pathname and the area's configuration.
 * Output: The most specific matching item's title, or the brand subtitle.
 * Use case: The site header's heading.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function pageTitle(pathname: string, config: DashboardConfig): string {
  const items = [...config.navMain, ...config.navGroups.flatMap((group) => group.items), ...config.navSecondary];
  let best: { title: string; length: number } | null = null;
  for (const item of items) {
    const href = item.href.split("?")[0] ?? item.href;
    if (isActivePath(pathname, href) && (!best || href.length > best.length)) {
      best = { title: item.title, length: href.length };
    }
  }
  return best?.title ?? config.brand.subtitle;
}

/**
 * Description: Render the dashboard's top bar (dashboard-01's SiteHeader).
 * Input: The area's configuration and optional right-hand controls.
 * Output: Sidebar trigger, separator, the page title and the controls.
 * Use case: DashboardShell.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function SiteHeader({ config, actions }: SiteHeaderProps) {
  const pathname = usePathname();

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full min-w-0 items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <p className="truncate text-base font-medium">{pageTitle(pathname, config)}</p>
        <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
      </div>
    </header>
  );
}

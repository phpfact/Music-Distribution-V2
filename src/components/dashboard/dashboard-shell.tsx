"use client";

import type { CSSProperties, ReactNode } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { SiteHeader } from "./site-header";
import type { DashboardConfig } from "./types";

type DashboardShellProps = {
  config: DashboardConfig;
  /** The area's own sign-out Server Action. */
  logoutAction: () => Promise<void>;
  /** Open/collapsed preference read on the server (first paint matches). */
  sidebarOpen: boolean;
  /** The area's preference cookie: name and the only path it is sent to. */
  sidebarCookie: { name: string; path: string };
  /** Controls on the right of the header (theme switch). */
  headerActions?: ReactNode;
  children: ReactNode;
};

/**
 * Description: Lay out a dashboard exactly like shadcn's dashboard-01 block.
 * Input: The area's configuration, sign-out action, sidebar preference and
 *   cookie, header controls and the page content.
 * Output: SidebarProvider (sidebar 18rem, header 3rem) → inset AppSidebar →
 *   SidebarInset with SiteHeader and an `@container/main` content column whose
 *   width follows the user's Appearance width setting.
 * Use case: The tenant (/tenant/**) and customer (/customer/**) layouts. Each
 *   area passes its own data and actions; this component has no auth or data access.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function DashboardShell({
  config,
  logoutAction,
  sidebarOpen,
  sidebarCookie,
  headerActions,
  children,
}: DashboardShellProps) {
  return (
    <SidebarProvider
      defaultOpen={sidebarOpen}
      stateCookieName={sidebarCookie.name}
      stateCookiePath={sidebarCookie.path}
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as CSSProperties
      }
    >
      <AppSidebar variant="inset" config={config} logoutAction={logoutAction} />
      <SidebarInset>
        <SiteHeader config={config} actions={headerActions} />
        <div className="flex flex-1 flex-col">
          <div
            id="main-content"
            className="@container/main mx-auto flex w-full flex-1 flex-col gap-2"
            style={{ maxWidth: "var(--workspace-content-max-width, 96rem)" }}
          >
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">{children}</div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

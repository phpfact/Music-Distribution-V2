"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { sidebarCookie } from "../sidebar-preference";
import { Icon } from "./icons";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

// Tailwind's desktop breakpoint matches the persistent sidebar's visibility.
const DESKTOP_QUERY = "(min-width: 64rem)";

type ConsoleShellProps = {
  username: string;
  initialCollapsed: boolean;
  children: ReactNode;
};

/**
 * Frame console pages with saved desktop navigation and a mobile shadcn Sheet.
 * Input: owner username, server-read sidebar preference, and page content.
 * Output: responsive navigation and content using the resolved account width.
 * Use case: preserve layout preferences and accessible mobile navigation.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function ConsoleShell({ username, initialCollapsed, children }: ConsoleShellProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const pathname      = usePathname();
  const [drawerPath, setDrawerPath] = useState(pathname);
  const asideId  = useId();
  const drawerId = useId();

  // Like ThemeRoot's identity reconciliation, reset during render so even
  // back/forward navigation cannot paint or later reopen the preceding drawer.
  if (drawerPath !== pathname) {
    setDrawerPath(pathname);
    setDrawerOpen(false);
  }

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);

    /**
     * Close mobile navigation when its desktop counterpart becomes visible.
     * Input: the desktop media-query change event.
     * Output: closes the Sheet when the viewport reaches the desktop breakpoint.
     * Use case: prevent an invisible mobile trigger from leaving a modal open.
     * Author: Mr. Sachin Sharma
     * Created: 2026-10-15
     * Last modified: 2026-10-15
     */
    function onChange(event: MediaQueryListEvent) {
      if (event.matches) setDrawerOpen(false);
    }

    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  /**
   * Toggle and save the existing desktop sidebar preference.
   * Input: current collapsed state.
   * Output: updated sidebar width and the established preference cookie.
   * Use case: keep first-paint sidebar width consistent across navigation/reloads.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = sidebarCookie(next);
  }

  return (
    <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
      <div className="flex h-dvh overflow-hidden bg-background text-foreground">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-lg focus:border focus:border-border focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:outline-2 focus:outline-offset-2 focus:outline-ring">
          Skip to content
        </a>

        <aside
          id={asideId}
          className={`hidden shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 motion-reduce:transition-none lg:flex ${collapsed ? "w-[4.5rem]" : "w-[17rem] overflow-hidden"}`}
        >
          <Sidebar
            collapsed={collapsed}
            footer={
              <div className="shrink-0 border-t border-border p-3">
                {collapsed ? null : (
                  <div className="mx-1 mb-3 flex items-center gap-2.5 rounded-xl border border-border bg-background px-3 py-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon name="shield-check" className="size-4" /></span>
                    <div className="min-w-0"><p className="truncate text-xs font-semibold">Owner workspace</p><p className="mt-0.5 text-[11px] text-muted-foreground">Platform administration</p></div>
                  </div>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={toggleCollapsed}
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  aria-expanded={!collapsed}
                  aria-controls={asideId}
                  className={`h-10 w-full gap-3 rounded-xl text-xs text-muted-foreground ${collapsed ? "justify-center px-0" : "justify-start px-3"}`}
                >
                  <Icon name="panel-left" className="size-5 shrink-0" />
                  {collapsed ? null : <span className="truncate">Collapse sidebar</span>}
                </Button>
              </div>
            }
          />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar username={username} drawerId={drawerId} drawerOpen={drawerOpen} onOpenDrawer={() => setDrawerOpen(true)} menuToggleRef={menuToggleRef} />
          <main id="main-content" tabIndex={-1} className="relative flex-1 overflow-y-auto focus:outline-none">
            {/* Full Width removes only the content cap, keeping mobile gutters. */}
            <div style={{ maxWidth: "var(--platform-content-max-width, 96rem)" }} className="mx-auto w-full px-4 py-7 sm:px-6 lg:px-9 lg:py-9">
              {children}
            </div>
          </main>
        </div>
      </div>

      <SheetContent
        id={drawerId}
        side="left"
        showCloseButton={false}
        className="w-72 max-w-[85vw] gap-0 p-0 sm:max-w-[85vw]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!window.matchMedia(DESKTOP_QUERY).matches) menuToggleRef.current?.focus();
        }}
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">Navigate platform administration pages.</SheetDescription>
        <Sidebar
          collapsed={false}
          onNavigate={() => setDrawerOpen(false)}
          headerAction={
            <SheetClose asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Close navigation" className="ml-auto size-9 shrink-0 text-muted-foreground">
                <Icon name="x" className="size-5" />
              </Button>
            </SheetClose>
          }
        />
      </SheetContent>
    </Sheet>
  );
}

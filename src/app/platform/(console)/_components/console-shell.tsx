"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { sidebarCookie } from "../sidebar-preference";
import { Icon } from "./icons";
import { Sidebar } from "./sidebar";
import { FOCUS_RING } from "./styles";
import { Topbar } from "./topbar";

// Tailwind's `lg` breakpoint: from here on the desktop sidebar is shown.
const DESKTOP_QUERY = "(min-width: 64rem)";

type ConsoleShellProps = {
  username: string;
  /** From the preference cookie, so the first paint already has the right width. */
  initialCollapsed: boolean;
  children: ReactNode;
};

/**
 * The frame around every console page: sidebar, mobile drawer and top bar.
 * It lives in the layout, so its state survives client-side navigation.
 * Input: owner username, saved sidebar collapse state, and page content.
 * Output: responsive navigation and content constrained by the resolved width.
 * Use case: apply the same saved content-width preference throughout the console.
 * Created: 2026-10-14. Last modified: 2026-10-14.
 */
export function ConsoleShell({ username, initialCollapsed, children }: ConsoleShellProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const asideId = useId();
  const drawerId = useId();

  // Any navigation, also with the browser's back and forward, closes the drawer.
  useEffect(() => {
    drawerRef.current?.close();
  }, [pathname]);

  // The drawer has no toggle on wide screens: close it when the window grows.
  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    function onChange(event: MediaQueryListEvent) {
      if (event.matches) drawerRef.current?.close();
    }
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  function openDrawer() {
    const drawer = drawerRef.current;
    if (!drawer || drawer.open) return;
    // Modal: traps focus, closes on Escape and makes the page behind inert.
    drawer.showModal();
    setDrawerOpen(true);
  }

  function closeDrawer() {
    drawerRef.current?.close();
  }

  // Every way of closing ends here, Escape included.
  function onDrawerClose() {
    setDrawerOpen(false);
    menuToggleRef.current?.focus();
  }

  // The drawer's content fills it, so a click on the dialog itself is on the backdrop.
  function onDrawerClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) closeDrawer();
  }

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = sidebarCookie(next);
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas text-fg">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-lg focus:border focus:border-line focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-fg focus:shadow-lg focus:outline-2 focus:outline-offset-2 focus:outline-accent"
      >
        Skip to content
      </a>

      {/* Expanded, the labels must not spill out while the width animates. */}
      <aside
        id={asideId}
        className={`hidden shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 motion-reduce:transition-none lg:flex ${
          collapsed ? "w-[4.5rem]" : "w-[17rem] overflow-hidden"
        }`}
      >
        <Sidebar
          collapsed={collapsed}
          footer={
            <div className="shrink-0 border-t border-line p-3">
              {collapsed ? null : (
                <div className="mx-1 mb-3 flex items-center gap-2.5 rounded-xl border border-line bg-canvas px-3 py-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><Icon name="shield-check" className="size-4" /></span>
                  <div className="min-w-0"><p className="truncate text-xs font-semibold">Owner workspace</p><p className="mt-0.5 text-[11px] text-fg-subtle">Platform administration</p></div>
                </div>
              )}
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-expanded={!collapsed}
                aria-controls={asideId}
                className={`flex h-10 w-full items-center gap-3 rounded-xl text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg ${FOCUS_RING} ${
                  collapsed ? "justify-center px-0" : "px-3"
                }`}
              >
                <Icon name="panel-left" className="size-5 shrink-0" />
                {collapsed ? null : <span className="truncate">Collapse sidebar</span>}
              </button>
            </div>
          }
        />
      </aside>

      <dialog
        ref={drawerRef}
        id={drawerId}
        aria-label="Navigation"
        onClose={onDrawerClose}
        onClick={onDrawerClick}
        className="m-0 h-dvh max-h-dvh w-72 max-w-[85vw] border-r border-line bg-surface p-0 text-fg backdrop:bg-black/60"
      >
        <Sidebar
          collapsed={false}
          onNavigate={closeDrawer}
          headerAction={
            <button
              type="button"
              onClick={closeDrawer}
              aria-label="Close navigation"
              className={`ml-auto grid size-9 shrink-0 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg ${FOCUS_RING}`}
            >
              <Icon name="x" className="size-5" />
            </button>
          }
        />
      </dialog>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          username={username}
          drawerId={drawerId}
          drawerOpen={drawerOpen}
          onOpenDrawer={openDrawer}
          menuToggleRef={menuToggleRef}
        />
        {/* `relative`: the containing block for absolutely positioned content
            (sr-only text), which would otherwise be placed against the viewport
            and stretch the page outside this scroll container. */}
        <main
          id="main-content"
          tabIndex={-1}
          className="relative flex-1 overflow-y-auto focus:outline-none"
        >
          {/* Full Width removes only the content cap, keeping responsive gutters. */}
          <div
            style={{ maxWidth: "var(--platform-content-max-width, 96rem)" }}
            className="mx-auto w-full px-4 py-7 sm:px-6 lg:px-9 lg:py-9"
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

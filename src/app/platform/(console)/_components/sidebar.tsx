"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, type ReactNode } from "react";
import { getNavItem, isNavItemActive, PLATFORM_NAV_SECTIONS, type PlatformNavItem } from "../navigation";
import { Icon } from "./icons";
import { FOCUS_RING } from "./styles";

type SidebarProps = {
  /** Icons only, with the labels as tooltips. The mobile drawer is never collapsed. */
  collapsed: boolean;
  /** Called when a navigation link is chosen (the drawer closes itself). */
  onNavigate?: () => void;
  /** Rendered at the end of the branding row, e.g. the drawer's close button. */
  headerAction?: ReactNode;
  /** Rendered below the navigation, e.g. the desktop collapse toggle. */
  footer?: ReactNode;
};

/** Branding and navigation, shared by the desktop sidebar and the mobile drawer. */
export function Sidebar({ collapsed, onNavigate, headerAction, footer }: SidebarProps) {
  const pathname = usePathname();
  // Both instances are in the document at once; their label ids must differ.
  const idPrefix = useId();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={`flex h-16 shrink-0 items-center gap-2 border-b border-line ${
          collapsed ? "justify-center px-2" : "px-4"
        }`}
      >
        <Link
          href={getNavItem("dashboard").href}
          onClick={onNavigate}
          aria-label={collapsed ? "Music Distribution — Platform Administration" : undefined}
          className={`flex min-w-0 items-center gap-3 rounded-lg ${FOCUS_RING}`}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-fg">
            <Icon name="disc-3" className="size-5" />
          </span>
          {collapsed ? null : (
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-fg">Music Distribution</span>
              <span className="truncate text-xs text-fg-subtle">Platform Administration</span>
            </span>
          )}
        </Link>
        {headerAction}
      </div>

      {/* Collapsed, the tooltips stick out to the right: nothing may clip them. */}
      <nav
        aria-label="Platform"
        className={`min-h-0 flex-1 px-3 py-4 ${collapsed ? "overflow-visible" : "overflow-y-auto"}`}
      >
        <div className={`flex flex-col ${collapsed ? "gap-3" : "gap-6"}`}>
          {PLATFORM_NAV_SECTIONS.map((section, index) => {
            const labelId = `${idPrefix}-${section.id}`;
            return (
              <div key={section.id}>
                {collapsed && index > 0 ? (
                  <div aria-hidden="true" className="mx-2 mb-3 h-px bg-line" />
                ) : null}
                <p
                  id={labelId}
                  className={
                    collapsed
                      ? "sr-only"
                      : "mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle"
                  }
                >
                  {section.label}
                </p>
                <ul aria-labelledby={labelId} className="flex flex-col gap-1">
                  {section.items.map((item) => (
                    <li key={item.id}>
                      <SidebarLink
                        item={item}
                        active={isNavItemActive(item, pathname)}
                        collapsed={collapsed}
                        onNavigate={onNavigate}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </nav>

      {footer}
    </div>
  );
}

type SidebarLinkProps = {
  item: PlatformNavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
};

function SidebarLink({ item, active, collapsed, onNavigate }: SidebarLinkProps) {
  const planned = item.status === "planned";

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`group relative flex h-10 items-center gap-3 rounded-lg text-sm transition-colors motion-reduce:transition-none hover:bg-surface-2 hover:text-fg ${FOCUS_RING} ${
        collapsed ? "justify-center px-0" : "px-3"
      } ${active ? "bg-accent-soft font-semibold text-fg" : "font-medium text-fg-muted"}`}
    >
      {/* The active item is marked by more than its colour. */}
      {active ? (
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent"
        />
      ) : null}
      <Icon name={item.icon} className={`size-5 shrink-0 ${active ? "text-accent" : ""}`} />
      <span className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate"}>
        {item.label}
        {planned ? <span className="sr-only"> (coming soon)</span> : null}
      </span>
      {planned && !collapsed ? (
        <span
          aria-hidden="true"
          className="ml-auto shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-fg-subtle uppercase"
        >
          Soon
        </span>
      ) : null}
      {collapsed ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-full z-50 ml-3 rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium whitespace-nowrap text-fg opacity-0 shadow-lg transition-opacity motion-reduce:transition-none group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          {item.label}
          {planned ? " · Coming soon" : null}
        </span>
      ) : null}
    </Link>
  );
}

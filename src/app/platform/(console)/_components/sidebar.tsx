"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getNavItem, isNavItemActive, type PlatformNavItem, type PlatformNavSection } from "../navigation";
import { Icon } from "./icons";
import { FOCUS_RING } from "./styles";

type SidebarProps = {
  /** The navigation the owner may see (already filtered by privilege). */
  sections: readonly PlatformNavSection[];
  collapsed: boolean;
  onNavigate?: () => void;
  headerAction?: ReactNode;
  footer?: ReactNode;
};

/**
 * Description: Render the existing navigation registry in the desktop sidebar or Sheet.
 * Input: the privilege-filtered sections, collapsed layout, optional
 *   close-on-navigation callback and extra controls.
 * Output: semantic grouped links composed with shadcn Button and Tooltip.
 * Use case: share route labels, active states, and accessible collapsed navigation.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-16
 */
export function Sidebar({ sections, collapsed, onNavigate, headerAction, footer }: SidebarProps) {
  const pathname = usePathname();
  const idPrefix = useId();

  return (
    <div className="flex h-full min-h-0 flex-col">
        <div className={`flex h-20 shrink-0 items-center gap-2 ${collapsed ? "justify-center px-2" : "px-5"}`}>
          <Link href={getNavItem("dashboard").href} onClick={onNavigate} aria-label={collapsed ? "Music Distribution — Platform Administration" : undefined} className={`flex min-w-0 items-center gap-3 rounded-lg ${FOCUS_RING}`}>
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm"><Icon name="disc-3" className="size-5" /></span>
            {collapsed ? null : (
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold tracking-tight">Music Distribution</span>
                <span className="mt-0.5 truncate text-[11px] text-muted-foreground">Platform Administration</span>
              </span>
            )}
          </Link>
          {headerAction}
        </div>

        <nav aria-label="Platform" className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
          <div className={`flex flex-col ${collapsed ? "gap-3" : "gap-6"}`}>
            {sections.map((section, index) => {
              const labelId = `${idPrefix}-${section.id}`;
              return (
                <div key={section.id}>
                  {collapsed && index > 0 ? <Separator className="mx-auto mb-3 w-[calc(100%-1rem)]" /> : null}
                  <p id={labelId} className={collapsed ? "sr-only" : "mb-2.5 px-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground"}>{section.label}</p>
                  <ul aria-labelledby={labelId} className="flex flex-col gap-1">
                    {section.items.map((item) => (
                      <li key={item.id}>
                        <SidebarLink item={item} active={isNavItemActive(item, pathname)} collapsed={collapsed} onNavigate={onNavigate} />
                        {item.children && item.children.length > 0 && !collapsed ? (
                          <ul className="ml-5 mt-1 space-y-1 border-l border-border pl-3" aria-label={`${item.label} pages`}>
                            {item.children.map((child) => {
                              const active = pathname === child.href || pathname.startsWith(`${child.href}/`);
                              return (
                                <li key={child.href}>
                                  <Button asChild variant="ghost" className={`h-9 w-full justify-start gap-2 rounded-lg px-3 text-xs ${active ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}>
                                    <Link href={child.href} onClick={onNavigate} aria-current={active ? "page" : undefined}><Icon name={child.icon} className="size-3.5" />{child.label}</Link>
                                  </Button>
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
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

/**
 * Description: Compose a navigation link and its optional collapsed-mode tooltip.
 * Input: the registry item, route match, layout state and navigation callback.
 * Output: one accessible link with persistent current-page and planned labels.
 * Use case: show active navigation without relying on color alone.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function SidebarLink({ item, active, collapsed, onNavigate }: SidebarLinkProps) {
  const planned = item.status === "planned";
  const link = (
    <Button asChild variant="ghost" className={`relative h-11 w-full gap-3 rounded-xl text-[13px] motion-reduce:transition-none ${collapsed ? "justify-center px-0" : "justify-start px-3"} ${active ? "bg-primary/10 font-semibold text-primary" : "font-medium text-muted-foreground"}`}>
      <Link href={item.href} onClick={onNavigate} aria-current={active && (collapsed || !item.children) ? "page" : undefined}>
        {active ? <span aria-hidden="true" className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary" /> : null}
        <Icon name={item.icon} className={`size-[18px] shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
        <span className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate"}>{item.label}{planned ? <span className="sr-only"> (coming soon)</span> : null}</span>
        {planned && !collapsed ? <Badge aria-hidden="true" variant="secondary" className="ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">Soon</Badge> : null}
      </Link>
    </Button>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={12}>{item.label}{planned ? " · Coming soon" : null}</TooltipContent>
    </Tooltip>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Ref } from "react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { findActiveNavItem, getNavItem, type PlatformNavSection } from "../navigation";
import { Icon } from "./icons";
import { ProfileMenu } from "./profile-menu";
import { ThemeToggle } from "./theme-toggle";

type TopbarProps = {
  username: string;
  /** The owner's role name (or "No active role") for the account menu. */
  roleLabel: string;
  /** The navigation the owner may see; the breadcrumb only names visible items. */
  sections: readonly PlatformNavSection[];
  drawerId: string;
  drawerOpen: boolean;
  onOpenDrawer: () => void;
  menuToggleRef: Ref<HTMLButtonElement>;
};

/**
 * Description: Render route breadcrumbs, mobile navigation access, and account controls.
 * Input: current account name, role label, the privilege-filtered sections and
 *   controlled mobile drawer state/focus ref.
 * Output: the common responsive shadcn-based console header.
 * Use case: retain route context and accessible controls on every console page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-16
 */
export function Topbar({ username, roleLabel, sections, drawerId, drawerOpen, onOpenDrawer, menuToggleRef }: TopbarProps) {
  const pathname = usePathname();
  const current  = findActiveNavItem(pathname, sections.flatMap((section) => section.items));
  const child    = current?.children?.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));

  return (
    <header className="flex h-20 shrink-0 items-center gap-3 border-b border-border bg-card/80 px-4 backdrop-blur sm:px-6 lg:px-9">
      <Button ref={menuToggleRef} type="button" variant="ghost" size="icon" onClick={onOpenDrawer} aria-label="Open navigation" aria-haspopup="dialog" aria-controls={drawerId} aria-expanded={drawerOpen} className="size-9 shrink-0 text-muted-foreground lg:hidden">
        <Icon name="menu" className="size-5" />
      </Button>

      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="min-w-0 flex-nowrap gap-2.5">
          <BreadcrumbItem className="hidden sm:inline-flex">
            <BreadcrumbLink asChild><Link href={getNavItem("dashboard").href}>Platform</Link></BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden sm:block" />
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="block truncate font-semibold">{child ? `${current?.label} / ${child.label}` : current?.label ?? "Platform"}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
        <ThemeToggle />
        <Separator orientation="vertical" className="h-6" />
        <ProfileMenu username={username} roleLabel={roleLabel} />
      </div>
    </header>
  );
}

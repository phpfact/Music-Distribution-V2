"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Ref } from "react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { findActiveNavItem, getNavItem } from "../navigation";
import { Icon } from "./icons";
import { ProfileMenu } from "./profile-menu";
import { ThemeToggle } from "./theme-toggle";

type TopbarProps = {
  username: string;
  drawerId: string;
  drawerOpen: boolean;
  onOpenDrawer: () => void;
  menuToggleRef: Ref<HTMLButtonElement>;
};

/**
 * Render route breadcrumbs, mobile navigation access, and account controls.
 * Input: current account name and controlled mobile drawer state/focus ref.
 * Output: the common responsive shadcn-based console header.
 * Use case: retain route context and accessible controls on every console page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function Topbar({ username, drawerId, drawerOpen, onOpenDrawer, menuToggleRef }: TopbarProps) {
  const pathname = usePathname();
  const current  = findActiveNavItem(pathname);
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
        <ProfileMenu username={username} />
      </div>
    </header>
  );
}

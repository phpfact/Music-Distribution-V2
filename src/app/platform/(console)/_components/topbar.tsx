"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Ref } from "react";
import { findActiveNavItem, getNavItem } from "../navigation";
import { Icon } from "./icons";
import { ProfileMenu } from "./profile-menu";
import { FOCUS_RING } from "./styles";
import { ThemeToggle } from "./theme-toggle";

type TopbarProps = {
  username: string;
  /** The mobile navigation drawer this bar opens. */
  drawerId: string;
  drawerOpen: boolean;
  onOpenDrawer: () => void;
  /** Focus goes back here when the drawer closes. */
  menuToggleRef: Ref<HTMLButtonElement>;
};

export function Topbar({ username, drawerId, drawerOpen, onOpenDrawer, menuToggleRef }: TopbarProps) {
  const pathname = usePathname();
  const current = findActiveNavItem(pathname);
  const child = current?.children?.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));

  return (
    <header className="flex h-20 shrink-0 items-center gap-3 border-b border-line bg-surface/80 px-4 backdrop-blur sm:px-6 lg:px-9">
      <button
        ref={menuToggleRef}
        type="button"
        onClick={onOpenDrawer}
        aria-label="Open navigation"
        aria-haspopup="dialog"
        aria-controls={drawerId}
        aria-expanded={drawerOpen}
        className={`grid size-9 shrink-0 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg lg:hidden ${FOCUS_RING}`}
      >
        <Icon name="menu" className="size-5" />
      </button>

      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="flex min-w-0 items-center gap-2.5 text-sm">
          <li className="hidden items-center gap-2 sm:flex">
            <Link
              href={getNavItem("dashboard").href}
              className={`rounded text-fg-subtle transition-colors hover:text-fg ${FOCUS_RING}`}
            >
              Platform
            </Link>
            <Icon name="chevron-right" className="size-3.5 text-fg-subtle" />
          </li>
          <li className="min-w-0">
            <span aria-current="page" className="block truncate font-semibold text-fg">
              {child ? `${current?.label} / ${child.label}` : current?.label ?? "Platform"}
            </span>
          </li>
        </ol>
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
        <ThemeToggle />
        <span aria-hidden="true" className="h-6 w-px bg-line" />
        <ProfileMenu username={username} />
      </div>
    </header>
  );
}

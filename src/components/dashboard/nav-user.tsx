"use client";

import { EllipsisVertical, Eye, EyeOff, LogOut, Palette } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import type { DashboardUser } from "./types";

// A fixed-length mask: it never reveals how long the hidden value is.
const MASK = "••••••••••";

/**
 * Description: Build up to two initials from a person's name.
 * Input: The display name.
 * Output: e.g. "Asha Rao" → "AR"; "?" when the name has no letters.
 * Use case: The avatar fallback (no profile images in the portal yet).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  return letters || "?";
}

/**
 * Description: Render the "Log out" menu item as the submit button of its form.
 * Input: None (reads the enclosing form's pending state).
 * Output: A menu item that submits the sign-out Server Action, shows
 *   "Signing out…" with a spinner and blocks repeat clicks while pending.
 * Use case: NavUser.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function LogOutItem() {
  const { pending } = useFormStatus();

  return (
    // The menu stays open while the form submits, so the pending state is visible.
    <DropdownMenuItem asChild disabled={pending} onSelect={(event) => event.preventDefault()}>
      <button type="submit" className="w-full" aria-busy={pending || undefined}>
        {pending ? <Spinner /> : <LogOut />}
        {pending ? "Signing out…" : "Log out"}
      </button>
    </DropdownMenuItem>
  );
}

type NavUserProps = {
  user: DashboardUser;
  appearanceHref: string;
  /** The area's sign-out Server Action (tenant or customer, never shared). */
  logoutAction: () => Promise<void>;
};

/**
 * Description: Render the account menu at the bottom of the sidebar (dashboard-01's NavUser).
 * Input: The signed-in person, the area's Appearance link and sign-out action.
 * Output: A trigger with initials, name and role; a menu with the masked
 *   username and email (CLAUDE.md: revealed only with the eye item), the
 *   Appearance link and Log out. A noscript form keeps sign-out usable without JavaScript.
 * Use case: AppSidebar footer in the tenant and customer areas.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function NavUser({ user, appearanceHref, logoutAction }: NavUserProps) {
  const { isMobile } = useSidebar();
  // Masked by default; masked again whenever the menu closes.
  const [revealed, setRevealed] = useState(false);
  const initials = initialsOf(user.name);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu onOpenChange={(open) => (open ? undefined : setRevealed(false))}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              aria-label="Account menu"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.roleLabel}</span>
              </div>
              <EllipsisVertical className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  {revealed ? (
                    <>
                      {user.username ? <span className="truncate text-xs">@{user.username}</span> : null}
                      <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                    </>
                  ) : (
                    <>
                      {/* Dots for the eye; screen readers hear "hidden" instead. */}
                      <span aria-hidden="true" className="text-xs tracking-[0.2em] text-muted-foreground">{MASK}</span>
                      <span className="sr-only">Username and email hidden</span>
                    </>
                  )}
                </div>
              </div>
            </DropdownMenuLabel>
            {/* A real menu item, so keyboard users reach it; it keeps the menu open. */}
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setRevealed((value) => !value);
              }}
            >
              {revealed ? <EyeOff /> : <Eye />}
              {revealed ? "Hide account details" : "Show account details"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link href={appearanceHref}>
                  <Palette />
                  Appearance
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <form action={logoutAction}>
              <LogOutItem />
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* The menu is portalled after hydration; keep a real form for no-JavaScript visitors. */}
        <noscript>
          <form action={logoutAction}>
            <button type="submit">Log out</button>
          </form>
        </noscript>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { logoutAction } from "@/app/platform/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getNavItem } from "../navigation";
import { Avatar } from "./avatar";
import { Icon } from "./icons";
import { SignOutButton } from "./sign-out-button";

// The same fixed-length mask as SensitiveValue: it never reveals the username's length.
const USERNAME_MASK = "••••••••••";

type ProfileMenuProps = {
  username: string;
  /** The owner's role name (or "No active role"), shown instead of the sensitive username. */
  roleLabel: string;
};

/**
 * Description: Render the owner's account menu without showing the username by default.
 * Input: The signed-in owner's username and role label.
 * Output: A trigger with the role name and its initials; a menu with the
 *   masked username, a "Show username" / "Hide username" item (eye icon), the
 *   settings link and the native sign-out Server Action form.
 * Use case: The console top bar on every page (CLAUDE.md sensitive-data masking:
 *   usernames are masked by default and revealed only on request).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
export function ProfileMenu({ username, roleLabel }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  // Masked by default; reset whenever the menu closes.
  const [usernameVisible, setUsernameVisible] = useState(false);

  /**
   * Description: Open or close the menu, hiding the username again on close.
   * Input: The requested open state.
   * Output: Updated menu state.
   * Use case: DropdownMenu's onOpenChange.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) setUsernameVisible(false);
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={changeOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            aria-label="Account menu"
            className="h-10 max-w-full gap-2 px-1.5 sm:pr-2"
          >
            {/* Role initials: the username's letters would reveal part of it. */}
            <Avatar name={roleLabel} size="sm" />
            <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:block">
              {roleLabel}
            </span>
            <Icon
              name="chevron-down"
              className={`size-4 shrink-0 text-muted-foreground motion-safe:transition-transform ${open ? "rotate-180" : ""}`}
            />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" sideOffset={8} className="w-64">
          <DropdownMenuLabel className="space-y-0.5 font-normal">
            <p className="text-xs text-muted-foreground">Signed in as</p>
            <p className="truncate text-sm font-medium">
              {usernameVisible ? (
                username
              ) : (
                <>
                  {/* Dots for the eye; screen readers hear "hidden" instead. */}
                  <span aria-hidden="true" className="tracking-[0.2em] text-muted-foreground">
                    {USERNAME_MASK}
                  </span>
                  <span className="sr-only">Username hidden</span>
                </>
              )}
            </p>
            <p className="text-xs text-muted-foreground">{roleLabel}</p>
          </DropdownMenuLabel>
          {/* A menu item, so keyboard users reach it; selecting it keeps the menu open. */}
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setUsernameVisible((visible) => !visible);
            }}
          >
            {usernameVisible ? <EyeOff className="size-4 shrink-0" /> : <Eye className="size-4 shrink-0" />}
            {usernameVisible ? "Hide username" : "Show username"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={getNavItem("settings").href}>
              <Icon name="settings" className="size-4 shrink-0" />
              Platform settings
            </Link>
          </DropdownMenuItem>
          <form action={logoutAction}>
            <SignOutButton menuItem />
          </form>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Portalled menus mount in the browser. Preserve a real Server Action
          form in initial HTML for browsers with JavaScript disabled. */}
      <noscript>
        <form action={logoutAction}>
          <SignOutButton />
        </form>
      </noscript>
    </>
  );
}

"use client";

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

type ProfileMenuProps = {
  username: string;
};

/**
 * Render the owner's account menu with shadcn keyboard and focus behavior.
 * Input: the authenticated owner's display username.
 * Output: account settings and the existing native sign-out Server Action.
 * Use case: provide account navigation without changing authentication logic.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15. Last modified: 2026-10-15.
 */
export function ProfileMenu({ username }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            aria-label={`Account menu for ${username}`}
            className="h-10 max-w-full gap-2 px-1.5 sm:pr-2"
          >
            <Avatar name={username} size="sm" />
            <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:block">
              {username}
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
            <p className="truncate text-sm font-medium">{username}</p>
            <p className="text-xs text-muted-foreground">Platform Owner</p>
          </DropdownMenuLabel>
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

"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Icon } from "./icons";
import { Spinner } from "./spinner";

/**
 * Submit the enclosing sign-out form and retain its pending feedback.
 * Input: whether this button belongs to an interactive account menu.
 * Output: a native submit button, optionally composed as a shadcn menu item.
 * Use case: preserve progressive sign-out and block repeat submissions.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function SignOutButton({ menuItem = false }: { menuItem?: boolean }) {
  const { pending } = useFormStatus();
  const button = (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-busy={pending || undefined}
      className={menuItem ? "h-auto w-full justify-start rounded-sm px-2 py-1.5 font-normal" : undefined}
    >
      {pending ? <Spinner /> : <Icon name="log-out" className="size-4 shrink-0" />}
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );

  if (!menuItem) return button;

  return (
    // Keep the menu mounted while the native form submits, so its pending
    // feedback remains visible. Radix still handles keyboard activation.
    <DropdownMenuItem asChild disabled={pending} onSelect={(event) => event.preventDefault()}>
      {button}
    </DropdownMenuItem>
  );
}

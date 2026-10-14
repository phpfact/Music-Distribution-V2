"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { logoutAction } from "@/app/platform/actions";
import { getNavItem } from "../navigation";
import { Icon } from "./icons";
import { getInitials } from "./initials";
import { SignOutButton } from "./sign-out-button";
import { FOCUS_RING, MENU_ITEM_CLASS } from "./styles";

type ProfileMenuProps = {
  username: string;
};

/**
 * The account menu in the top bar (WAI-ARIA menu button). The panel is always
 * in the server-rendered HTML, only hidden while closed: the sign-out form
 * inside it then also works before, or without, JavaScript.
 */
export function ProfileMenu({ username }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerId = useId();
  const menuId = useId();

  // A press anywhere outside the menu closes it.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function menuItems(): HTMLElement[] {
    const menu = menuRef.current;
    if (!menu) return [];
    return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'));
  }

  function openMenu(focus: "first" | "last" | null) {
    // The panel must be visible before one of its items can take focus.
    flushSync(() => setOpen(true));
    if (focus === null) return;
    const items = menuItems();
    (focus === "first" ? items[0] : items.at(-1))?.focus();
  }

  function closeMenu(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function onTriggerClick(event: MouseEvent<HTMLButtonElement>) {
    if (open) {
      closeMenu(false);
      return;
    }
    // detail is 0 for a click made with Enter or Space: move focus into the menu.
    openMenu(event.detail === 0 ? "first" : null);
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu("first");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu("last");
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      closeMenu(true);
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = menuItems();
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        items[index <= 0 ? items.length - 1 : index - 1]?.focus();
        break;
      case "Home":
        event.preventDefault();
        items[0]?.focus();
        break;
      case "End":
        event.preventDefault();
        items.at(-1)?.focus();
        break;
      case "Escape":
        event.preventDefault();
        closeMenu(true);
        break;
      case "Tab":
        // Focus moves on as usual; the menu just does not stay open behind it.
        closeMenu(false);
        break;
      case " ":
        // Space activates a button natively, but not a link.
        if (event.target instanceof HTMLAnchorElement) {
          event.preventDefault();
          event.target.click();
        }
        break;
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        onClick={onTriggerClick}
        onKeyDown={onTriggerKeyDown}
        aria-label={`Account menu for ${username}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className={`flex h-10 max-w-full items-center gap-2 rounded-lg px-1.5 transition-colors hover:bg-surface-2 sm:pr-2 ${FOCUS_RING}`}
      >
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent"
        >
          {getInitials(username)}
        </span>
        <span className="hidden max-w-[10rem] truncate text-sm font-medium text-fg sm:block">
          {username}
        </span>
        <Icon
          name="chevron-down"
          className={`size-4 shrink-0 text-fg-subtle motion-safe:transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        aria-labelledby={triggerId}
        hidden={!open}
        onKeyDown={onMenuKeyDown}
        className="absolute top-full right-0 z-50 mt-2 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-xl shadow-black/20"
      >
        <div role="none" className="px-2.5 py-2">
          <p className="text-xs text-fg-subtle">Signed in as</p>
          <p className="truncate text-sm font-medium text-fg">{username}</p>
          <p className="text-xs text-fg-muted">Platform Owner</p>
        </div>
        <div role="separator" className="my-1.5 h-px bg-line" />
        <Link
          href={getNavItem("settings").href}
          role="menuitem"
          tabIndex={-1}
          onClick={() => setOpen(false)}
          className={MENU_ITEM_CLASS}
        >
          <Icon name="settings" className="size-4 shrink-0" />
          Platform settings
        </Link>
        <form action={logoutAction}>
          <SignOutButton />
        </form>
      </div>
    </div>
  );
}

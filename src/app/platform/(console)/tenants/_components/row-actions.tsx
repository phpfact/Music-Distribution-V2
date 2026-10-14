"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { flushSync } from "react-dom";
import { Icon } from "../../_components/icons";
import { FOCUS_RING, MENU_ITEM_CLASS } from "../../_components/styles";
import type { TenantStatus } from "../labels";
import { TENANTS_PATH } from "../list-query";
import { LifecycleDialog, type LifecycleAction } from "./lifecycle-dialog";

type TenantRowActionsProps = {
  tenantId: string;
  tenantName: string;
  status: TenantStatus;
};

// Room the panel needs below the button before it opens upwards instead.
const MENU_HEIGHT_ESTIMATE = 120;

/**
 * "View" and the overflow menu (Edit, Suspend or Reactivate) of one tenant in
 * the list. The menu follows the WAI-ARIA menu button pattern of the account
 * menu. Its panel is fixed to the viewport, so the table's horizontal scroll
 * box cannot clip it; scrolling or resizing closes it.
 */
export function TenantRowActions({ tenantId, tenantName, status }: TenantRowActionsProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const [dialog, setDialog] = useState<LifecycleAction | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerId = useId();
  const menuId = useId();
  const detailsHref = `${TENANTS_PATH}/${tenantId}`;

  // A press outside, a scroll or a resize closes it: the panel would float off its button.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onMove() {
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  function menuItems(): HTMLElement[] {
    const menu = menuRef.current;
    if (!menu) return [];
    return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'));
  }

  function placeMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const right = window.innerWidth - rect.right;
    setPosition(
      rect.bottom + MENU_HEIGHT_ESTIMATE > window.innerHeight
        ? { right, bottom: window.innerHeight - rect.top + 4 }
        : { right, top: rect.bottom + 4 },
    );
  }

  function openMenu(focus: "first" | "last" | null) {
    // The panel must be placed and visible before one of its items can take focus.
    flushSync(() => {
      placeMenu();
      setOpen(true);
    });
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

  function openDialog(action: LifecycleAction) {
    // The dialog takes focus; back on the trigger once it closes.
    setOpen(false);
    setDialog(action);
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Link
        href={detailsHref}
        aria-label={`View ${tenantName}`}
        className={`inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent-soft ${FOCUS_RING}`}
      >
        View
      </Link>
      <div ref={containerRef}>
        <button
          ref={triggerRef}
          id={triggerId}
          type="button"
          onClick={onTriggerClick}
          onKeyDown={onTriggerKeyDown}
          aria-label={`More actions for ${tenantName}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          className={`grid size-8 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg ${FOCUS_RING}`}
        >
          <Icon name="more-horizontal" className="size-4" />
        </button>
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          hidden={!open}
          onKeyDown={onMenuKeyDown}
          style={position}
          className="fixed z-50 w-48 rounded-xl border border-line bg-surface p-1.5 shadow-xl shadow-black/20"
        >
          <Link
            href={`${detailsHref}/edit`}
            role="menuitem"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className={MENU_ITEM_CLASS}
          >
            <Icon name="pencil" className="size-4 shrink-0" />
            Edit
          </Link>
          {status === "active" ? (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => openDialog("suspend")}
              className={MENU_ITEM_CLASS}
            >
              <Icon name="ban" className="size-4 shrink-0" />
              Suspend
            </button>
          ) : null}
          {status === "suspended" ? (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => openDialog("reactivate")}
              className={MENU_ITEM_CLASS}
            >
              <Icon name="rotate-ccw" className="size-4 shrink-0" />
              Reactivate
            </button>
          ) : null}
        </div>
      </div>
      <LifecycleDialog
        action={dialog}
        onClose={() => {
          setDialog(null);
          triggerRef.current?.focus();
        }}
        tenantId={tenantId}
        tenantName={tenantName}
      />
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Icon } from "../../_components/icons";
import type { TenantStatus } from "../labels";
import { TENANTS_PATH } from "../list-query";
import { LifecycleDialog, type LifecycleAction } from "./lifecycle-dialog";

/** What the signed-in owner may do from a directory row (from the server's privilege check). */
export type TenantRowPermissions = {
  /** platform.tenants.edit: the Edit item. */
  edit: boolean;
  /** platform.tenants.suspend: the Suspend / Reactivate items. */
  suspend: boolean;
};

type TenantRowActionsProps = {
  tenantId: string;
  tenantName: string;
  status: TenantStatus;
  can: TenantRowPermissions;
};

/**
 * Description: Render tenant navigation and permission-appropriate lifecycle actions.
 * Input: The tenant identity, display name, existing lifecycle status and the
 *   owner's row permissions.
 * Output: The View link plus a shadcn menu with only the permitted items (Edit
 *   with edit; Suspend/Reactivate with suspend) and the existing confirmation
 *   workflow; the menu is omitted when it would be empty. The Server Actions
 *   check the privileges again.
 * Use case: The desktop directory table and responsive tenant cards.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-16
 */
export function TenantRowActions({
  tenantId,
  tenantName,
  status,
  can,
}: TenantRowActionsProps) {
  const [dialog, setDialog] = useState<LifecycleAction | null>(null);
  const triggerRef  = useRef<HTMLButtonElement>(null);
  const detailsHref = `${TENANTS_PATH}/${tenantId}`;
  // The lifecycle item this status offers, if the owner may use it.
  const canSuspend    = can.suspend && status === "active";
  const canReactivate = can.suspend && status === "suspended";
  const hasMenu       = can.edit || canSuspend || canReactivate;

  return (
    <div className="flex items-center justify-end gap-1">
      <Button asChild variant="ghost" size="sm" className="text-primary">
        <Link href={detailsHref} aria-label={`View ${tenantName}`}>
          View
        </Link>
      </Button>
      {/* The shared portal keeps the menu outside the table's overflow box and inside ThemeRoot. */}
      {hasMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={triggerRef}
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              aria-label={`More actions for ${tenantName}`}
            >
              <Icon name="more-horizontal" className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-48"
            onCloseAutoFocus={(event) => {
              // The newly opened confirmation owns focus until it closes.
              if (dialog !== null) event.preventDefault();
            }}
          >
            {can.edit ? (
              <DropdownMenuItem asChild>
                <Link href={`${detailsHref}/edit`}>
                  <Icon name="pencil" className="size-4" />
                  Edit
                </Link>
              </DropdownMenuItem>
            ) : null}
            {canSuspend ? (
              <DropdownMenuItem onSelect={() => setDialog("suspend")}>
                <Icon name="ban" className="size-4" />
                Suspend
              </DropdownMenuItem>
            ) : null}
            {canReactivate ? (
              <DropdownMenuItem onSelect={() => setDialog("reactivate")}>
                <Icon name="rotate-ccw" className="size-4" />
                Reactivate
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <LifecycleDialog
        action={dialog}
        onClose={() => setDialog(null)}
        returnFocusRef={triggerRef}
        tenantId={tenantId}
        tenantName={tenantName}
      />
    </div>
  );
}

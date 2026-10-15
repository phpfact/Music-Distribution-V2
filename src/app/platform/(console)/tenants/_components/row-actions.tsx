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

type TenantRowActionsProps = {
  tenantId: string;
  tenantName: string;
  status: TenantStatus;
};

/**
 * Description: Render tenant navigation and permission-appropriate lifecycle actions.
 * Input: The tenant identity, display name and existing lifecycle status.
 * Output: A shadcn menu and the existing confirmation workflow.
 * Use case: The desktop directory table and responsive tenant cards.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function TenantRowActions({
  tenantId,
  tenantName,
  status,
}: TenantRowActionsProps) {
  const [dialog, setDialog] = useState<LifecycleAction | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const detailsHref = `${TENANTS_PATH}/${tenantId}`;

  return (
    <div className="flex items-center justify-end gap-1">
      <Button asChild variant="ghost" size="sm" className="text-primary">
        <Link href={detailsHref} aria-label={`View ${tenantName}`}>
          View
        </Link>
      </Button>
      {/* The shared portal keeps the menu outside the table's overflow box and inside ThemeRoot. */}
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
          <DropdownMenuItem asChild>
            <Link href={`${detailsHref}/edit`}>
              <Icon name="pencil" className="size-4" />
              Edit
            </Link>
          </DropdownMenuItem>
          {status === "active" ? (
            <DropdownMenuItem onSelect={() => setDialog("suspend")}>
              <Icon name="ban" className="size-4" />
              Suspend
            </DropdownMenuItem>
          ) : null}
          {status === "suspended" ? (
            <DropdownMenuItem onSelect={() => setDialog("reactivate")}>
              <Icon name="rotate-ccw" className="size-4" />
              Reactivate
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
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

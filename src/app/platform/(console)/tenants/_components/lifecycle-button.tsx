"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "../../_components/icons";
import { LifecycleDialog, type LifecycleAction } from "./lifecycle-dialog";

type LifecycleButtonProps = {
  action: LifecycleAction;
  tenantId: string;
  tenantName: string;
  variant?: "default" | "outline" | "destructive" | "ghost";
};

const BUTTONS = {
  suspend: { label: "Suspend", icon: "ban", variant: "destructive" },
  reactivate: { label: "Reactivate", icon: "rotate-ccw", variant: "default" },
  retry: { label: "Retry setup", icon: "refresh-cw", variant: "default" },
} as const satisfies Record<
  LifecycleAction,
  { label: string; icon: IconName; variant: LifecycleButtonProps["variant"] }
>;

/**
 * Description: Render a button that opens one lifecycle confirmation.
 * Input: The action (suspend, reactivate, retry), the tenant id and name and an
 *   optional button variant.
 * Output: The button and its LifecycleDialog (every lifecycle change is confirmed first).
 * Use case: The details page header and Setup Progress card.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function LifecycleButton({
  action,
  tenantId,
  tenantName,
  variant,
}: LifecycleButtonProps) {
  const [open, setOpen] = useState(false);
  const button = BUTTONS[action];

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        variant={variant ?? button.variant}
      >
        <Icon name={button.icon} className="size-4" />
        {button.label}
      </Button>
      {/* The shared confirmation primitive restores focus to its initiating control. */}
      <LifecycleDialog
        action={open ? action : null}
        onClose={() => setOpen(false)}
        tenantId={tenantId}
        tenantName={tenantName}
      />
    </>
  );
}

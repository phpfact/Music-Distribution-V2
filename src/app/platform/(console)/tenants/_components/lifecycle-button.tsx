"use client";

import { useState } from "react";
import { Icon, type IconName } from "../../_components/icons";
import { buttonClass, type ButtonVariant } from "../../_components/ui";
import { LifecycleDialog, type LifecycleAction } from "./lifecycle-dialog";

type LifecycleButtonProps = {
  action: LifecycleAction;
  tenantId: string;
  tenantName: string;
  variant?: ButtonVariant;
};

const BUTTONS: Record<LifecycleAction, { label: string; icon: IconName; variant: ButtonVariant }> = {
  suspend: { label: "Suspend", icon: "ban", variant: "danger" },
  reactivate: { label: "Reactivate", icon: "rotate-ccw", variant: "primary" },
  retry: { label: "Retry setup", icon: "refresh-cw", variant: "primary" },
};

/** A button that opens the confirmation of one lifecycle action (details page). */
export function LifecycleButton({ action, tenantId, tenantName, variant }: LifecycleButtonProps) {
  const [open, setOpen] = useState(false);
  const button = BUTTONS[action];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClass(variant ?? button.variant)}
      >
        <Icon name={button.icon} className="size-4" />
        {button.label}
      </button>
      {/* The native dialog gives focus back to this button when it closes. */}
      <LifecycleDialog
        action={open ? action : null}
        onClose={() => setOpen(false)}
        tenantId={tenantId}
        tenantName={tenantName}
      />
    </>
  );
}

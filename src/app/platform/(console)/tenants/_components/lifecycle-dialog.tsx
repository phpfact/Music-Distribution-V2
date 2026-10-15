"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type RefObject } from "react";
import { SUSPENSION_REASON_MAX_LENGTH } from "@/lib/tenants/rules";
import { ConfirmDialog } from "../../_components/confirm-dialog";
import {
  reactivateTenantAction,
  retryProvisioningAction,
  suspendTenantAction,
} from "../actions";
import type { TenantLifecycleActionResult } from "../action-types";
import { useTenantFlash } from "./tenant-flash";

export type LifecycleAction = "suspend" | "reactivate" | "retry";

type LifecycleDialogProps = {
  /** The dialog to show, or null when none is open. */
  action: LifecycleAction | null;
  onClose: () => void;
  tenantId: string;
  tenantName: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

const SUCCESS: Record<LifecycleAction, string> = {
  suspend: "Tenant suspended.",
  reactivate: "Tenant reactivated.",
  retry: "Setup restarted. Progress appears below.",
};

// Unexpected failures (the action threw, the network dropped) get one safe sentence.
const FAILED = "The action could not be completed. Try again shortly.";

/**
 * Suspend, Reactivate and Retry setup, each behind a confirmation. Used by the
 * list's row menu and the details page. A failure stays in the dialog; a
 * success closes it, reports through the page's flash notice and refreshes
 * the server-rendered data.
 * Input: tenant/action state and optional stable return-focus ref.
 * Output: guarded confirmations with unchanged lifecycle Server Actions.
 * Use case: preserve reason validation, failure drafts and focus after closing.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
export function LifecycleDialog({
  action,
  onClose,
  tenantId,
  tenantName,
  returnFocusRef,
}: LifecycleDialogProps) {
  const router = useRouter();
  const flash = useTenantFlash();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [shownAction, setShownAction] = useState(action);

  // A newly opened dialog starts without the previous one's error.
  if (action !== shownAction) {
    setShownAction(action);
    setError(null);
  }

  function run(current: LifecycleAction, reason?: string) {
    setError(null);
    startTransition(async () => {
      let result: TenantLifecycleActionResult;
      try {
        if (current === "suspend")
          result = await suspendTenantAction(tenantId, reason ?? "");
        else if (current === "reactivate")
          result = await reactivateTenantAction(tenantId);
        else result = await retryProvisioningAction(tenantId);
      } catch {
        setError(FAILED);
        return;
      }
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onClose();
      flash.show(SUCCESS[current]);
      router.refresh();
    });
  }

  const common = {
    returnFocusRef,
    onClose: () => {
      if (!pending) onClose();
    },
    pending,
    error,
  };

  return (
    <>
      <ConfirmDialog
        {...common}
        open={action === "suspend"}
        title={`Suspend ${tenantName}?`}
        description="The tenant loses access immediately. Its database, files and domain are kept."
        confirmLabel="Suspend tenant"
        confirmVariant="danger"
        reason={{
          label: "Reason",
          hint: "Shown on the tenant's page and kept in its status history.",
          maxLength: SUSPENSION_REASON_MAX_LENGTH,
          required: true,
        }}
        onConfirm={(reason) => run("suspend", reason)}
      />
      <ConfirmDialog
        {...common}
        open={action === "reactivate"}
        title={`Reactivate ${tenantName}?`}
        description="The tenant regains access immediately. The suspension stays in its status history."
        confirmLabel="Reactivate tenant"
        onConfirm={() => run("reactivate")}
      />
      <ConfirmDialog
        {...common}
        open={action === "retry"}
        title={`Retry setup for ${tenantName}?`}
        description="Setup runs again in the background. Nothing that was already set up is deleted."
        confirmLabel="Retry setup"
        onConfirm={() => run("retry")}
      />
    </>
  );
}

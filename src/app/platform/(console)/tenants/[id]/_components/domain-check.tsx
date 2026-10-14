"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "../../../_components/icons";
import { Notice } from "../../../_components/notice";
import { Spinner } from "../../../_components/spinner";
import { buttonClass } from "../../../_components/ui";
import { useTenantFlash } from "../../_components/tenant-flash";
import type { DomainCheckActionResult } from "../../action-types";
import { recheckSubdomainAction, verifyCustomDomainAction } from "../../manage-actions";

const FAILED = "The check could not be run. Try again shortly.";

const KINDS = {
  custom: {
    label: "Check DNS",
    pendingLabel: "Checking…",
    success: "Custom domain verified. It is active now.",
    run: verifyCustomDomainAction,
  },
  subdomain: {
    label: "Check again",
    pendingLabel: "Checking…",
    success: "Subdomain checked. It is active now.",
    run: recheckSubdomainAction,
  },
} as const;

type Outcome = { variant: "warning" | "error"; message: string } | null;

/**
 * "Check DNS" (custom domain) and "Check again" (subdomain), inline on the
 * Domains card. A pass reports through the page's flash notice and refreshes
 * the card; a failed DNS check is a warning that names the record to add.
 */
export function DomainCheck({ tenantId, kind }: { tenantId: string; kind: keyof typeof KINDS }) {
  const router = useRouter();
  const flash = useTenantFlash();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<Outcome>(null);
  const config = KINDS[kind];

  function check() {
    if (pending) return;
    setOutcome(null);
    startTransition(async () => {
      let result: DomainCheckActionResult;
      try {
        result = await config.run(tenantId);
      } catch {
        setOutcome({ variant: "error", message: FAILED });
        return;
      }
      if (result.ok) {
        flash.show(config.success);
      } else {
        setOutcome({ variant: result.reason === "dns" ? "warning" : "error", message: result.message });
      }
      // A failed check records its time and reason too.
      if (result.ok || result.reason === "dns") router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <button
          type="button"
          onClick={check}
          aria-disabled={pending || undefined}
          className={buttonClass("secondary", "sm")}
        >
          {pending ? <Spinner size="sm" /> : <Icon name="refresh-cw" className="size-4" />}
          {pending ? config.pendingLabel : config.label}
        </button>
      </div>
      <div aria-live="polite" className="empty:hidden">
        {outcome ? <Notice variant={outcome.variant}>{outcome.message}</Notice> : null}
      </div>
    </div>
  );
}

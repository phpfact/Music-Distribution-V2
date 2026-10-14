"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { CopyButton } from "../../_components/copy-button";
import { Icon } from "../../_components/icons";
import { buttonClass } from "../../_components/ui";

type SuccessPanelProps = {
  tenantId: string;
  /** Auto generate only: shown here once, held in component state alone. */
  generatedMasterPassword?: string;
  onCreateAnother: () => void;
};

/** Replaces the form once the tenant is recorded; setup continues in the background. */
export function SuccessPanel({ tenantId, generatedMasterPassword, onCreateAnother }: SuccessPanelProps) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The form that had focus is gone: the outcome is announced from its heading.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby={titleId} className="rounded-xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
          <Icon name="circle-check" className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            ref={headingRef}
            id={titleId}
            tabIndex={-1}
            className="text-lg font-semibold text-fg focus:outline-none"
          >
            Tenant created
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Setup runs in the background: database, schema, admin account and domain.
          </p>
        </div>
      </div>

      {generatedMasterPassword ? (
        <div className="mt-5 rounded-lg border border-accent/40 bg-accent-soft p-4">
          <p className="text-sm font-semibold text-fg">Master password</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm break-all text-fg">
              {generatedMasterPassword}
            </code>
            <CopyButton value={generatedMasterPassword} label="Copy master password" />
          </div>
          <p className="mt-3 flex items-start gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
            <Icon name="alert-triangle" className="mt-0.5 size-4 shrink-0" />
            Copy it now. It won&apos;t be shown again.
          </p>
        </div>
      ) : null}

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCreateAnother}
          className={`${buttonClass("secondary")} w-full sm:w-auto`}
        >
          Create another tenant
        </button>
        <Link href={`/platform/tenants/${tenantId}`} className={`${buttonClass("primary")} w-full sm:w-auto`}>
          View tenant
        </Link>
      </div>
    </section>
  );
}

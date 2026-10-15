"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CopyButton } from "../../_components/copy-button";
import { Icon } from "../../_components/icons";

type SuccessPanelProps = {
  tenantId: string;
  /**
   * Auto generate only: shown here once, held in component state alone.
   */
  generatedMasterPassword?: string;
  onCreateAnother: () => void;
};

/**
 * Replaces the form once the tenant is recorded; setup continues in the background.
 * Input: The existing typed arguments and component state.
 * Output: Accessible React UI.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
export function SuccessPanel({
  tenantId,
  generatedMasterPassword,
  onCreateAnother,
}: SuccessPanelProps) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The form that had focus is gone: the outcome is announced from its heading.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby={titleId}>
      <Card className="gap-0 py-0">
        <CardContent className="p-5 sm:p-6">
          <div className="flex gap-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-success/10 text-success">
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
                Setup runs in the background: database, schema, admin account
                and domain.
              </p>
            </div>
          </div>

          {generatedMasterPassword ? (
            <div className="mt-5 rounded-lg border border-primary/40 bg-primary/10 p-4">
              <p className="text-sm font-semibold text-fg">Master password</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm break-all text-fg">
                  {generatedMasterPassword}
                </code>
                <CopyButton
                  value={generatedMasterPassword}
                  label="Copy master password"
                />
              </div>
              <p className="mt-3 flex items-start gap-2 text-sm font-medium text-warning">
                <Icon
                  name="alert-triangle"
                  className="mt-0.5 size-4 shrink-0"
                />
                Copy it now. It won&apos;t be shown again.
              </p>
            </div>
          ) : null}

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              onClick={onCreateAnother}
              variant="outline"
              className="w-full sm:w-auto"
            >
              Create another tenant
            </Button>
            <Button asChild variant="default" className="w-full sm:w-auto">
              <Link href={`/platform/tenants/${tenantId}`}>View tenant</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

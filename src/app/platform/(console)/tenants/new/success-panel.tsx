"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "../../_components/icons";
import { SensitiveValue } from "../../_components/sensitive-value";
import type { GeneratedSummary } from "./form-model";

type SuccessPanelProps = {
  tenantId: string;
  /**
   * Login section on Auto-Generate only: shown here once, held in component state alone.
   */
  generatedMasterPassword?: string;
  /**
   * The identifiers the Auto sections submitted. The form never displayed
   * them, so this is where the owner first sees them.
   */
  generated: GeneratedSummary;
  onCreateAnother: () => void;
};

/** One generated value as the panel lists it. */
type GeneratedRow = {
  label: string;
  value: string;
  /** For the eye button: "Show username". */
  noun: string;
};

/**
 * Description: Turn the generated summary into labelled rows, in the order of the form's sections.
 * Input: The identifiers the Auto sections submitted.
 * Output: Only the rows that have a value.
 * Use case: The "Generated values" list of the success panel.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15. Last modified: 2026-10-15.
 */
function generatedRows(generated: GeneratedSummary): GeneratedRow[] {
  const rows: (GeneratedRow | null)[] = [
    generated.username
      ? { label: "Username", value: generated.username, noun: "username" }
      : null,
    generated.databaseName
      ? {
          label: "Database name",
          value: generated.databaseName,
          noun: "database name",
        }
      : null,
    generated.databaseUser
      ? {
          label: "Database user",
          value: generated.databaseUser,
          noun: "database user",
        }
      : null,
    generated.subdomainHost
      ? {
          label: "SaaS subdomain",
          value: generated.subdomainHost,
          noun: "subdomain",
        }
      : null,
  ];
  return rows.filter((row): row is GeneratedRow => row !== null);
}

/**
 * Replaces the form once the tenant is recorded; setup continues in the background.
 * Shows what the Auto sections generated (masked until revealed) and, when the
 * login was generated, the master password once.
 * Input: The new tenant id, the generated values and the "create another" callback.
 * Output: Accessible React UI.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
export function SuccessPanel({
  tenantId,
  generatedMasterPassword,
  generated,
  onCreateAnother,
}: SuccessPanelProps) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rows = generatedRows(generated);

  // The form that had focus is gone: the outcome is announced from its heading.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby={titleId}>
      <Card className="gap-0 overflow-hidden py-0">
        <CardContent className="flex flex-col gap-6 p-5 sm:p-7">
          <div className="flex gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-success/10 text-success">
              <Icon name="circle-check" className="size-6" />
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

          {rows.length > 0 ? (
            <div className="rounded-lg border border-line">
              <p className="border-b border-line bg-surface-2 px-4 py-2.5 text-xs font-semibold tracking-wide text-fg-muted uppercase">
                Generated values
              </p>
              <dl className="divide-y divide-line">
                {rows.map((row) => (
                  <div
                    key={row.label}
                    className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <dt className="text-sm text-fg-muted sm:w-36 sm:shrink-0">
                      {row.label}
                    </dt>
                    <dd className="min-w-0 flex-1">
                      <SensitiveValue
                        value={row.value}
                        noun={row.noun}
                        copyLabel={`Copy ${row.noun}`}
                      />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {generatedMasterPassword ? (
            <div className="rounded-lg border border-primary/40 bg-primary/10 p-4">
              <p className="text-sm font-semibold text-fg">Master password</p>
              <SensitiveValue
                value={generatedMasterPassword}
                noun="master password"
                copyLabel="Copy master password"
                className="mt-2"
              />
              <p className="mt-3 flex items-start gap-2 text-sm font-medium text-warning">
                <Icon
                  name="alert-triangle"
                  className="mt-0.5 size-4 shrink-0"
                />
                Copy it now. It won&apos;t be shown again.
              </p>
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:justify-end">
            <Button
              type="button"
              onClick={onCreateAnother}
              variant="outline"
              className="w-full sm:w-auto"
            >
              <Icon name="plus" className="size-4" />
              Create another tenant
            </Button>
            <Button asChild variant="default" className="w-full sm:w-auto">
              <Link href={`/platform/tenants/${tenantId}`}>
                View tenant
                <Icon name="arrow-right" className="size-4" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

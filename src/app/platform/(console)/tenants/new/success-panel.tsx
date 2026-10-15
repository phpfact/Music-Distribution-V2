"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type MouseEvent, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "../../_components/confirm-dialog";
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
 * Created: 2026-10-15
 * Last modified: 2026-10-15
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

/** Where the owner wants to go once they confirm they have copied the password. */
type LeaveTarget = "create-another" | "view-tenant";

/**
 * Description: Replace the create form once the tenant is recorded.
 * Input: The new tenant id, the generated master password (Auto login only),
 *   the generated identifiers and the "create another" callback.
 * Output: The success card: generated values (masked, eye and copy), the
 *   one-time master password, and "Create another tenant" / "View tenant".
 *   While a generated password is shown, leaving asks for confirmation first,
 *   because the password is never shown again.
 * Use case: Right after a successful create; setup continues in the background.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function SuccessPanel({
  tenantId,
  generatedMasterPassword,
  generated,
  onCreateAnother,
}: SuccessPanelProps) {
  const router     = useRouter();
  const titleId    = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rows       = generatedRows(generated);
  // The leave action waiting for "I have copied it" (only with a generated password).
  const [pendingLeave, setPendingLeave] = useState<LeaveTarget | null>(null);
  const tenantHref = `/platform/tenants/${tenantId}`;

  /**
   * Description: Leave the panel for the chosen destination.
   * Input: The destination.
   * Output: Resets the form for another tenant, or opens the tenant's page.
   * Use case: After the confirmation, or directly when no password is shown.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function leave(target: LeaveTarget) {
    if (target === "create-another") onCreateAnother();
    else router.push(tenantHref);
  }

  /**
   * Description: Ask before leaving while the one-time password is still on screen.
   * Input: The destination and, for the link, its click event.
   * Output: The confirmation dialog, or the navigation when nothing would be lost.
   * Use case: "Create another tenant" and "View tenant" (CLAUDE.md: confirm risky actions).
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function requestLeave(target: LeaveTarget, event?: MouseEvent<HTMLAnchorElement>) {
    if (!generatedMasterPassword) {
      // Nothing is shown only once: a link keeps its normal navigation.
      if (target === "create-another") onCreateAnother();
      return;
    }
    event?.preventDefault();
    setPendingLeave(target);
  }

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
              onClick={() => requestLeave("create-another")}
              variant="outline"
              className="w-full sm:w-auto"
            >
              <Icon name="plus" className="size-4" />
              Create another tenant
            </Button>
            <Button asChild variant="default" className="w-full sm:w-auto">
              <Link href={tenantHref} onClick={(event) => requestLeave("view-tenant", event)}>
                View tenant
                <Icon name="arrow-right" className="size-4" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* The generated password exists only here: confirm before it disappears. */}
      <ConfirmDialog
        open={pendingLeave !== null}
        onClose={() => setPendingLeave(null)}
        title="Have you copied the master password?"
        description="It is shown only once. After you leave this page it can't be shown again; you would have to reset it."
        confirmLabel="Yes, I copied it"
        onConfirm={() => {
          const target = pendingLeave;
          setPendingLeave(null);
          if (target) leave(target);
        }}
      />
    </section>
  );
}

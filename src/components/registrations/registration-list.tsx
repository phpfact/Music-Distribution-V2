"use client";

import { Ban, Check, ChevronLeft, ChevronRight, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useRef, useState, useTransition } from "react";
import { ConfirmDialog, EmptyState, Notice, SensitiveValue } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  accountTypeLabel,
  REJECTION_REASON_MAX_LENGTH,
  validateRejectionReason,
  type RegistrationActionResult,
  type RegistrationListQuery,
  type RegistrationPage,
  type RegistrationRow,
} from "@/lib/workspace/rules";
import { formatRegistrationDate } from "./format";
import { registrationListHref } from "./list-href";
import { RegistrationStatusBadge } from "./registration-status-badge";

/** The review actions of one area (each is that area's own Server Action). */
export type RegistrationActions = {
  approve: (registrationId: string) => Promise<RegistrationActionResult>;
  reject: (registrationId: string, reason: string) => Promise<RegistrationActionResult>;
  suspend: (registrationId: string) => Promise<RegistrationActionResult>;
  reactivate: (registrationId: string) => Promise<RegistrationActionResult>;
};

type ActionKind = keyof RegistrationActions;

// What each confirmation says and how its button looks.
const DIALOGS: Record<ActionKind, { title: string; confirm: string; variant: "primary" | "danger"; describe: (name: string) => string }> = {
  approve: {
    title: "Approve this registration?",
    confirm: "Approve",
    variant: "primary",
    describe: (name) => `${name} gets a customer account and can log in right away.`,
  },
  reject: {
    title: "Reject this registration?",
    confirm: "Reject",
    variant: "danger",
    describe: (name) => `${name} cannot log in. They will see your reason and can ask for a new review.`,
  },
  suspend: {
    title: "Suspend this account?",
    confirm: "Suspend",
    variant: "danger",
    describe: (name) => `${name} is signed out everywhere and cannot log in until the account is reactivated.`,
  },
  reactivate: {
    title: "Reactivate this account?",
    confirm: "Reactivate",
    variant: "primary",
    describe: (name) => `${name} can log in again.`,
  },
};

// Shown when the Server Action itself could not be reached.
const ACTION_FAILED = "The change could not be saved. Check your connection and try again.";

type RegistrationListProps = {
  page: RegistrationPage;
  query: RegistrationListQuery;
  /** The list page's path (filters and paging links are built from it). */
  basePath: string;
  actions: RegistrationActions;
  /** Approve/Reject are offered only with the panel's review privilege (the server checks again). */
  canReview: boolean;
  /** Suspend/Reactivate are offered only with the panel's suspend privilege (the server checks again). */
  canSuspend: boolean;
};

/**
 * Description: Render one page of registrations with their review actions.
 * Input: The page of rows, the current query, the list path, the area's actions
 *   and the capability flags (canReview, canSuspend) from the viewer's privileges.
 * Output: A table on wide screens (xl) and cards below (masked email and
 *   username with eye buttons, status, submitted date, reason/message), the
 *   actions allowed for each status behind confirmation dialogs (Reject asks
 *   for a reason), success/error feedback, an empty state and paging links.
 *   After a change only the server data is refreshed (no full reload). Buttons
 *   the viewer may not use are not rendered (hiding is a convenience: every
 *   action re-checks its privilege on the server).
 * Use case: Tenant and Platform Owner registrations pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function RegistrationList({ page, query, basePath, actions, canReview, canSuspend }: RegistrationListProps) {
  const router                = useRouter();
  const [, startTransition]   = useTransition();
  const [open, setOpen]       = useState<{ kind: ActionKind; row: RegistrationRow } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Synchronous guard against a double click before React re-renders.
  const running = useRef(false);

  /**
   * Description: Open the confirmation of one action for one row.
   * Input: The action and the row.
   * Output: The dialog opens with a clean error.
   * Use case: Row action buttons.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function ask(kind: ActionKind, row: RegistrationRow) {
    setError(null);
    setSuccess(null);
    setOpen({ kind, row });
  }

  /**
   * Description: Run the confirmed action.
   * Input: The trimmed reason (Reject only).
   * Output: On success the dialog closes, a success notice shows and the list
   *   re-renders from the server; on failure the dialog stays open with the error.
   * Use case: ConfirmDialog's onConfirm.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  async function confirm(reason?: string) {
    if (!open || running.current) return;

    // Reject: the reason must pass the same rule as the server before sending.
    if (open.kind === "reject") {
      const checked = validateRejectionReason(reason ?? "");
      if (!checked.ok) {
        setError(checked.error);
        return;
      }
    }

    running.current = true;
    setPending(true);
    setError(null);
    try {
      const id     = open.row.id;
      const result =
        open.kind === "reject" ? await actions.reject(id, reason ?? "") : await actions[open.kind](id);
      if (result.ok) {
        setOpen(null);
        setSuccess(result.message);
        startTransition(() => router.refresh());
      } else {
        setError(result.error);
      }
    } catch {
      setError(ACTION_FAILED);
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  const dialog = open ? DIALOGS[open.kind] : null;

  return (
    <div className="flex flex-col gap-4">
      {success ? (
        <Notice variant="success" onDismiss={() => setSuccess(null)}>
          {success}
        </Notice>
      ) : null}

      {page.total === 0 ? (
        <EmptyState
          icon="user"
          title={query.q || query.status !== "all" ? "No registrations match" : "No registrations yet"}
          description={
            query.q || query.status !== "all"
              ? "Try another search or status, or clear the filters."
              : "When artists, labels or partners sign up on your portal, their requests appear here for review."
          }
          action={
            query.q || query.status !== "all" ? (
              <Button asChild variant="outline">
                <Link href={basePath}>Clear filters</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Wide screens: a table (from xl, where it fits beside the sidebar and menus). */}
          <div className="hidden overflow-x-auto rounded-lg border xl:block">
            <Table>
              <TableCaption className="sr-only">Customer registrations</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Applicant</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((row) => (
                  <TableRow key={row.id} className="align-top">
                    <TableCell>
                      <p className="font-medium">{row.fullName}</p>
                      <p className="text-xs text-muted-foreground">{accountTypeLabel(row.accountType)}</p>
                    </TableCell>
                    <TableCell>
                      <SensitiveValue value={row.email} noun="email" monospace={false} />
                    </TableCell>
                    <TableCell>
                      <SensitiveValue value={row.username} noun="username" />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatRegistrationDate(row.createdAt)}</TableCell>
                    <TableCell className="max-w-64 whitespace-normal">
                      <RegistrationStatusBadge status={row.status} />
                      <RowNotes row={row} />
                    </TableCell>
                    <TableCell>
                      <RowActions row={row} onAsk={ask} canReview={canReview} canSuspend={canSuspend} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Phones and tablets: one card per registration (actions always visible). */}
          <ul className="flex flex-col gap-3 xl:hidden">
            {page.rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium break-words">{row.fullName}</p>
                    <p className="text-xs text-muted-foreground">
                      {accountTypeLabel(row.accountType)} · {formatRegistrationDate(row.createdAt)}
                    </p>
                  </div>
                  <RegistrationStatusBadge status={row.status} />
                </div>
                <dl className="grid gap-2 text-sm">
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">Email</dt>
                    <dd><SensitiveValue value={row.email} noun="email" monospace={false} /></dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">Username</dt>
                    <dd><SensitiveValue value={row.username} noun="username" /></dd>
                  </div>
                </dl>
                <RowNotes row={row} />
                <RowActions row={row} onAsk={ask} canReview={canReview} canSuspend={canSuspend} />
              </li>
            ))}
          </ul>

          {/* Paging (client-side navigation, filters kept). */}
          <nav aria-label="Registrations pages" className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-muted-foreground">
              Showing {(page.page - 1) * page.pageSize + 1}–{Math.min(page.page * page.pageSize, page.total)} of{" "}
              {page.total}
            </p>
            {page.pageCount > 1 ? (
              <div className="flex items-center gap-2">
                <PageLink basePath={basePath} query={query} page={page.page - 1} disabled={page.page <= 1}>
                  <ChevronLeft aria-hidden="true" />
                  Previous
                </PageLink>
                <span className="text-muted-foreground">
                  Page {page.page} of {page.pageCount}
                </span>
                <PageLink basePath={basePath} query={query} page={page.page + 1} disabled={page.page >= page.pageCount}>
                  Next
                  <ChevronRight aria-hidden="true" />
                </PageLink>
              </div>
            ) : null}
          </nav>
        </>
      )}

      <ConfirmDialog
        open={open !== null}
        onClose={() => {
          setOpen(null);
          setError(null);
        }}
        title={dialog?.title ?? ""}
        description={open && dialog ? dialog.describe(open.row.fullName) : undefined}
        confirmLabel={dialog?.confirm ?? "Confirm"}
        confirmVariant={dialog?.variant ?? "primary"}
        pending={pending}
        error={error}
        onConfirm={(reason) => void confirm(reason)}
        reason={
          open?.kind === "reject"
            ? {
                label: "Reason (shown to the applicant)",
                hint: `3–${REJECTION_REASON_MAX_LENGTH} characters.`,
                maxLength: REJECTION_REASON_MAX_LENGTH,
                required: true,
              }
            : undefined
        }
      />
    </div>
  );
}

/**
 * Description: Show the rejection reason or the applicant's review message under a status.
 * Input: The row.
 * Output: A small muted paragraph, or nothing.
 * Use case: Table and card rows.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function RowNotes({ row }: { row: RegistrationRow }) {
  if (row.status === "rejected" && row.rejectionReason) {
    return <p className="mt-1.5 text-xs break-words text-muted-foreground">Reason: {row.rejectionReason}</p>;
  }
  if (row.status === "review_requested") {
    return (
      <p className="mt-1.5 text-xs break-words text-muted-foreground">
        {row.reviewRequestMessage ? `Applicant: “${row.reviewRequestMessage}”` : "The applicant asked for a new review."}
        {row.rejectionReason ? ` Earlier reason: ${row.rejectionReason}` : null}
      </p>
    );
  }
  if (row.reviewedBy && row.reviewedAt) {
    // The review is the approval; a later suspension is not attributed here.
    return (
      <p className="mt-1.5 text-xs text-muted-foreground">
        Approved by {row.reviewedBy}, {formatRegistrationDate(row.reviewedAt)}
      </p>
    );
  }
  return null;
}

/**
 * Description: Render the actions a registration's status allows and the viewer may use.
 * Input: The row, the callback that opens a confirmation and the capability flags.
 * Output: Approve + Reject (pending / review requested, with canReview), Suspend
 *   (active) / Reactivate (suspended) with canSuspend, the "Waiting for the
 *   applicant" note for rejected rows, and nothing when the viewer may not act.
 * Use case: Table and card rows. The server re-checks every transition and privilege.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function RowActions({
  row,
  onAsk,
  canReview,
  canSuspend,
}: {
  row: RegistrationRow;
  onAsk: (kind: ActionKind, row: RegistrationRow) => void;
  canReview: boolean;
  canSuspend: boolean;
}) {
  // Without the matching privilege the row offers no button at all.
  const reviewable = row.status === "pending" || row.status === "review_requested";
  if (reviewable && !canReview) return null;
  if ((row.status === "active" || row.status === "suspended") && !canSuspend) return null;
  if (reviewable) {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" onClick={() => onAsk("approve", row)} aria-label={`Approve ${row.fullName}`}>
          <Check aria-hidden="true" />
          Approve
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onAsk("reject", row)} aria-label={`Reject ${row.fullName}`}>
          <X aria-hidden="true" />
          Reject
        </Button>
      </div>
    );
  }
  if (row.status === "active") {
    return (
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" onClick={() => onAsk("suspend", row)} aria-label={`Suspend ${row.fullName}`}>
          <Ban aria-hidden="true" />
          Suspend
        </Button>
      </div>
    );
  }
  if (row.status === "suspended") {
    return (
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" onClick={() => onAsk("reactivate", row)} aria-label={`Reactivate ${row.fullName}`}>
          <RotateCcw aria-hidden="true" />
          Reactivate
        </Button>
      </div>
    );
  }
  return <p className="text-right text-xs text-muted-foreground">Waiting for the applicant</p>;
}

/**
 * Description: Render a Previous/Next paging link (client-side navigation).
 * Input: The list path and query, the target page, whether it is disabled, and the label.
 * Output: A Next Link styled as a button, or a disabled button.
 * Use case: RegistrationList paging.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function PageLink({
  basePath,
  query,
  page,
  disabled,
  children,
}: {
  basePath: string;
  query: RegistrationListQuery;
  page: number;
  disabled: boolean;
  children: ReactNode;
}) {
  if (disabled) {
    return (
      <Button type="button" variant="outline" size="sm" disabled>
        {children}
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={registrationListHref(basePath, { ...query, page })} scroll={false}>
        {children}
      </Link>
    </Button>
  );
}

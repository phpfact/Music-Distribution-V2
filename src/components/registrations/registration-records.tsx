"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState, Notice, SensitiveValue } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  accountTypeLabel,
  type RegistrationFilter,
  type RegistrationRecordsResult,
} from "@/lib/workspace/rules";
import { formatRegistrationDate } from "./format";
import { RegistrationStatusBadge } from "./registration-status-badge";

// Shown when the Server Action itself could not be reached.
const LOAD_FAILED = "The records could not be loaded right now. Try again.";
// Placeholder rows while loading.
const SKELETON_ROWS = 4;

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; result: Extract<RegistrationRecordsResult, { ok: true }> }
  | { status: "error"; message: string };

type RegistrationRecordsProps = {
  /** Which registrations the figure stands for. */
  filter: RegistrationFilter;
  /** The table's accessible caption, e.g. "Pending registrations". */
  caption: string;
  /** The area's own Server Action (it checks who may see the records). */
  loadRecords: (filter: RegistrationFilter, page: number) => Promise<RegistrationRecordsResult>;
};

/**
 * Description: List the exact registrations behind a figure, page by page from the server.
 * Input: The filter, a caption and the area's load action.
 * Output: A loading skeleton, then a table (name, type, masked email, status,
 *   submitted date) with Previous/Next paging, an empty state, or an error with Retry.
 * Use case: The records part of every registrations count-details popup
 *   (tenant dashboard, tenant and Platform Owner registrations pages).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function RegistrationRecords({ filter, caption, loadRecords }: RegistrationRecordsProps) {
  const [page, setPage]       = useState(1);
  const [state, setState]     = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  // Load the requested page; an answer for an older request is ignored.
  useEffect(() => {
    let obsolete = false;
    loadRecords(filter, page)
      .then((result) => {
        if (obsolete) return;
        setState(result.ok ? { status: "loaded", result } : { status: "error", message: result.error });
      })
      .catch(() => {
        if (!obsolete) setState({ status: "error", message: LOAD_FAILED });
      });
    return () => {
      obsolete = true;
    };
  }, [filter, page, attempt, loadRecords]);

  /**
   * Description: Show another page (with the loading state while it loads).
   * Input: The page number.
   * Output: The new page is requested.
   * Use case: Previous / Next buttons.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function goTo(next: number) {
    setState({ status: "loading" });
    setPage(next);
  }

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-2" role="status" aria-label="Loading records">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-3">
        <Notice variant="error">{state.message}</Notice>
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => {
            setState({ status: "loading" });
            setAttempt((value) => value + 1);
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  const { rows, total, pageCount, page: current } = state.result.page;
  if (total === 0) {
    return (
      <EmptyState
        size="sm"
        icon="user"
        title="No registrations here"
        description="There are no registrations in this group right now."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Submitted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.fullName}</TableCell>
                <TableCell>{accountTypeLabel(row.accountType)}</TableCell>
                <TableCell>
                  <SensitiveValue value={row.email} noun="email" monospace={false} />
                </TableCell>
                <TableCell>
                  <RegistrationStatusBadge status={row.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatRegistrationDate(row.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {pageCount > 1 ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <Button type="button" variant="outline" size="sm" disabled={current <= 1} onClick={() => goTo(current - 1)}>
            <ChevronLeft aria-hidden="true" />
            Previous
          </Button>
          <span className="text-muted-foreground">
            Page {current} of {pageCount}
          </span>
          <Button type="button" variant="outline" size="sm" disabled={current >= pageCount} onClick={() => goTo(current + 1)}>
            Next
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

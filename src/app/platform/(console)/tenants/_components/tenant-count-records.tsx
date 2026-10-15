"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "../../_components/empty-state";
import { Icon } from "../../_components/icons";
import { Notice } from "../../_components/notice";
import { StatusBadge } from "../../_components/status-badge";
import { FOCUS_RING } from "../../_components/styles";
import { loadTenantCountRecordsAction } from "../actions";
import type { TenantCountRecordsResult, TenantCountSource } from "../action-types";
import { formatDate } from "../format";
import { pageRowRange, TENANTS_PATH } from "../list-query";

// Shown when the Server Action itself could not be reached (network, server down).
const LOAD_FAILED = "The tenants could not be loaded right now. Try again.";
// How many placeholder rows the loading state draws.
const SKELETON_ROWS = 5;

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; result: Extract<TenantCountRecordsResult, { ok: true }> }
  | { status: "error"; message: string };

type TenantCountRecordsProps = {
  /** Which tenants: a summary figure, or the directory total with its filters. */
  source: TenantCountSource;
  /** The list's accessible caption, e.g. "Active tenants". */
  caption: string;
};

/**
 * Description: List the exact tenants behind a count, page by page from the server.
 * Input: The count's source (summary category or directory filters) and a caption.
 * Output: A loading skeleton, then a table (tenant link, status, created date)
 *   with Previous/Next paging; an empty state or an error with Retry when needed.
 * Use case: The records part of every tenant count-details dialog (dashboard
 *   and directory summary cards, the directory total).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function TenantCountRecords({ source, caption }: TenantCountRecordsProps) {
  // The page asked for, the latest load result, and a counter that forces a reload (Retry).
  const [page, setPage] = useState(1);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  // A string key: a parent re-render with an equal source does not reload.
  const sourceKey = JSON.stringify(source);

  // Load the requested page; a newer request makes the older answer obsolete.
  useEffect(() => {
    let obsolete    = false;
    const requested = JSON.parse(sourceKey) as TenantCountSource;

    loadTenantCountRecordsAction(requested, page)
      .then((result) => {
        if (obsolete) return;
        setState(result.ok ? { status: "loaded", result } : { status: "error", message: result.message });
      })
      .catch(() => {
        // The action could not be reached at all; nothing technical is shown.
        if (!obsolete) setState({ status: "error", message: LOAD_FAILED });
      });

    return () => {
      obsolete = true;
    };
  }, [sourceKey, page, attempt]);

  /**
   * Description: Show another page of the list.
   * Input: The 1-based page number.
   * Output: The loading state, then that page.
   * Use case: The Previous and Next buttons.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function goToPage(next: number) {
    setState({ status: "loading" });
    setPage(next);
  }

  /**
   * Description: Load the same page again after a failure.
   * Input: None.
   * Output: The loading state, then the page or the error again.
   * Use case: The Retry button of the error state.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function retry() {
    setState({ status: "loading" });
    setAttempt((count) => count + 1);
  }

  // Loading: placeholder rows instead of an empty area.
  if (state.status === "loading") {
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        <span role="status" className="sr-only">
          Loading tenants…
        </span>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  // Failure: a friendly message and a way to try again.
  if (state.status === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <Notice variant="error">{state.message}</Notice>
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          <Icon name="refresh-cw" className="size-4" />
          Retry
        </Button>
      </div>
    );
  }

  const { rows, total, pageSize, pageCount } = state.result;

  // Nothing behind the figure (it is 0, or the tenants changed since the page loaded).
  if (total === 0 || rows.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon="building-2"
        title="No tenants here"
        description="No tenant is counted in this figure right now."
      />
    );
  }

  const range = pageRowRange(state.result.page, pageSize, total);

  return (
    <div className="flex flex-col gap-3">
      <div className="max-h-[50dvh] overflow-auto rounded-lg border border-border">
        <Table className="text-sm">
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead scope="col">Tenant</TableHead>
              <TableHead scope="col">Status</TableHead>
              <TableHead scope="col">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="max-w-56 whitespace-normal">
                  <Link
                    href={`${TENANTS_PATH}/${row.id}`}
                    className={`rounded-sm font-medium break-words text-foreground hover:text-primary hover:underline ${FOCUS_RING}`}
                  >
                    {row.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={row.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  <time dateTime={row.createdAt}>{formatDate(row.createdAt)}</time>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Position in the list and paging; the server returns one page at a time. */}
      <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p aria-live="polite">
          {range ? `Showing ${range.first}–${range.last} of ${total}` : null}
        </p>
        {pageCount > 1 ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={state.result.page <= 1}
              onClick={() => goToPage(state.result.page - 1)}
            >
              <Icon name="chevron-left" className="size-4" />
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={state.result.page >= pageCount}
              onClick={() => goToPage(state.result.page + 1)}
            >
              Next
              <Icon name="chevron-right" className="size-4" />
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

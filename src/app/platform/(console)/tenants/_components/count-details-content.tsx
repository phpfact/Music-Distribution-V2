import type { ReactNode } from "react";
import type { TenantSummary } from "@/lib/tenants/service";
import type {
  TenantCountCategory,
  TenantListQuery,
  TenantListStatusFilter,
} from "@/lib/tenants/rules";
import type { StatCardDetails } from "../../_components/stat-card";
import { TenantCountRecords } from "./tenant-count-records";

/** The words a status filter is shown with in the directory's select. */
const STATUS_FILTER_LABELS: Readonly<Record<TenantListStatusFilter, string>> = {
  all: "All statuses",
  active: "Active",
  suspended: "Suspended",
  pending: "Pending setup",
  failed: "Failed",
};

/** The dialog title of each summary figure. */
const CATEGORY_TITLES: Readonly<Record<TenantCountCategory, string>> = {
  all: "All tenants",
  active: "Active tenants",
  suspended: "Suspended tenants",
  setup: "Tenants pending setup",
  failed: "Tenants whose setup failed",
};

/**
 * Description: Explain in plain words how one summary figure is calculated.
 * Input: The figure's category and the summary it belongs to.
 * Output: A sentence (with the arithmetic) that can be checked against the records.
 * Use case: The "How this is calculated" box of the summary count dialogs.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function categoryCalculation(category: TenantCountCategory, summary: TenantSummary): ReactNode {
  switch (category) {
    case "all": {
      // Statuses outside the three groups (e.g. being removed) are listed separately.
      const other = summary.total - summary.active - summary.suspended - summary.pendingSetup;
      return (
        <>
          Every tenant registered on the platform, whatever its status:
          Active {summary.active} + Suspended {summary.suspended} + Pending setup{" "}
          {summary.pendingSetup}
          {other > 0 ? ` + other statuses ${other}` : ""} = {summary.total}.
        </>
      );
    }
    case "active":
      return "Tenants whose status is Active: their setup has finished and they are not suspended.";
    case "suspended":
      return "Tenants whose status is Suspended: an owner suspended them, and their sites stay blocked until they are reactivated.";
    case "setup": {
      // "Pending setup" includes the failed ones, which wait for a retry.
      const waiting = summary.pendingSetup - summary.failed;
      return (
        <>
          Tenants whose setup has not finished: waiting or in progress {waiting} + failed{" "}
          {summary.failed} = {summary.pendingSetup}.
        </>
      );
    }
    case "failed":
      return "Tenants whose setup failed. Each one can be retried from its details page.";
  }
}

/**
 * Description: Build the details of one tenant summary figure for a StatCard.
 * Input: The figure's category and the loaded summary.
 * Output: The dialog title, description, calculation and the server-paged tenant list.
 * Use case: Summary cards of the dashboard and the tenant directory, and the
 *   directory's "N failed" note, so every figure opens the same verification.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function tenantSummaryDetails(
  category: TenantCountCategory,
  summary: TenantSummary,
): StatCardDetails {
  const title = CATEGORY_TITLES[category];
  return {
    title,
    description: "The exact tenants counted in this figure, newest first.",
    calculation: categoryCalculation(category, summary),
    records: <TenantCountRecords source={{ kind: "summary", category }} caption={title} />,
  };
}

/**
 * Description: Build the details of the directory's result total.
 * Input: The directory's current query (search, status, page), the total and the page size.
 * Output: The dialog title, description, calculation (filters and pages) and
 *   the server-paged list of the matching tenants.
 * Use case: The total badge and the "Showing a–b of n" line of the directory.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function tenantListDetails(
  query: TenantListQuery,
  total: number,
  pageSize: number,
): StatCardDetails {
  // Pages are counted the same way as in the directory (at least one).
  const pageCount  = Math.max(1, Math.ceil(total / pageSize));
  const searchText = query.q ? `search “${query.q}”` : "no search";
  return {
    title: "Tenants in this list",
    description: "The tenants that match the directory's current search and filter.",
    calculation: (
      <>
        Tenants matching {searchText} and status “{STATUS_FILTER_LABELS[query.status]}”: {total}.
        With {pageSize} per page that makes {pageCount} {pageCount === 1 ? "page" : "pages"}.
      </>
    ),
    records: (
      <TenantCountRecords
        source={{ kind: "list", q: query.q, status: query.status }}
        caption="Tenants in this list"
      />
    ),
  };
}

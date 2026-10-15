/**
 * URL helpers of the tenant screens: the list's query string, its pages and
 * the `?notice=` codes. Pure functions, importable from server and client
 * components and from tests.
 */
import type { TenantListQuery, TenantListStatusFilter } from "@/lib/tenants/rules";

export const TENANTS_PATH = "/platform/tenants";

export type TenantNoticeCode = "created" | "updated" | "updated-dns" | "suspended" | "reactivated";

// Fixed wording: the URL only picks one, it never supplies the text.
const TENANT_NOTICES: Readonly<Record<TenantNoticeCode, string>> = {
  created: "Tenant created. Setup runs in the background.",
  updated: "Tenant updated.",
  "updated-dns": "Tenant updated. The new domain needs a DNS check before it becomes active.",
  suspended: "Tenant suspended.",
  reactivated: "Tenant reactivated.",
};

/**
 * Description: Turn a `?notice=` code into its fixed message.
 * Input: The notice parameter.
 * Output: The message, or null for a missing or unknown code (the URL never supplies the text).
 * Use case: Directory and details pages after create/edit/lifecycle actions.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function tenantNoticeMessage(value: string | string[] | undefined): string | null {
  const code = Array.isArray(value) ? value[0] : value;
  if (code === undefined || !Object.hasOwn(TENANT_NOTICES, code)) return null;
  return TENANT_NOTICES[code as TenantNoticeCode];
}

/**
 * Description: Build a directory URL.
 * Input: The search, status and page (defaults are left out).
 * Output: `/platform/tenants?q=…&status=…&page=…`.
 * Use case: Pagination, empty states and the count dialogs.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function tenantListHref(query: Partial<TenantListQuery>): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status && query.status !== "all") params.set("status", query.status);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const search = params.toString();
  return search ? `${TENANTS_PATH}?${search}` : TENANTS_PATH;
}

/**
 * Description: Build the directory URL after a filter change.
 * Input: The current query string and the changed search/status.
 * Output: The URL with other parameters kept, the page reset to 1 and the one-off notice dropped.
 * Use case: The toolbar (search and status filter stay in the URL).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function tenantFilterHref(
  current: string | URLSearchParams,
  changes: { q?: string; status?: TenantListStatusFilter },
): string {
  const params = new URLSearchParams(current);
  params.delete("page");
  params.delete("notice");
  if (changes.q !== undefined) {
    const q = changes.q.trim();
    if (q) params.set("q", q);
    else params.delete("q");
  }
  if (changes.status !== undefined) {
    if (changes.status === "all") params.delete("status");
    else params.set("status", changes.status);
  }
  const search = params.toString();
  return search ? `${TENANTS_PATH}?${search}` : TENANTS_PATH;
}

/**
 * Description: Compute the positions of the rows on a page.
 * Input: The page, the page size and the total.
 * Output: The first and last row numbers ("Showing 21–40 of 45"), or null when the
 *   page holds none.
 * Use case: Directory pagination and the count dialogs.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function pageRowRange(
  page: number,
  pageSize: number,
  total: number,
): { first: number; last: number } | null {
  const first = (page - 1) * pageSize + 1;
  if (total <= 0 || first > total) return null;
  return { first, last: Math.min(page * pageSize, total) };
}

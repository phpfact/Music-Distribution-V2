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

/** The message for a `?notice=` value; null for a missing or unknown code. */
export function tenantNoticeMessage(value: string | string[] | undefined): string | null {
  const code = Array.isArray(value) ? value[0] : value;
  if (code === undefined || !Object.hasOwn(TENANT_NOTICES, code)) return null;
  return TENANT_NOTICES[code as TenantNoticeCode];
}

/** A list URL; the defaults (no search, all statuses, page 1) are left out. */
export function tenantListHref(query: Partial<TenantListQuery>): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status && query.status !== "all") params.set("status", query.status);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const search = params.toString();
  return search ? `${TENANTS_PATH}?${search}` : TENANTS_PATH;
}

/**
 * The list URL after a filter change: other parameters are kept, the page
 * starts over at 1 and a one-off notice is dropped.
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
 * The 1-based positions of the rows on a page ("Showing 21–40 of 45"); null
 * when the page holds none (no rows at all, or a page past the last one).
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

/**
 * URL state of the RBAC directories (roles and sub-users): search, status,
 * role filter and page live in the URL so they survive reloads, Back and
 * shared links (CLAUDE.md "filters in the URL"). Client-safe and pure: pages
 * use the same helpers on the server.
 */

/** The status filter values of a directory ("all" = no filter). */
export type RbacStatusFilter = "all" | "active" | "disabled";

/** The parsed list query of a roles or sub-users directory. */
export type RbacListQuery = {
  /** Trimmed search text ("" = none). */
  q: string;
  status: RbacStatusFilter;
  /** Role id filter of the sub-users directory ("" = all roles). */
  role: string;
  /** 1-based page. */
  page: number;
};

/** The longest search text a directory accepts. */
export const RBAC_SEARCH_MAX_LENGTH = 100;

/** The highest page number a directory accepts. */
export const RBAC_MAX_PAGE = 10_000;

/** Rows per directory page (spec: server-side pagination, 20). */
export const RBAC_PAGE_SIZE = 20;

/**
 * Description: Read one search parameter that may appear once, several times or not at all.
 * Input: The raw value from Next's searchParams.
 * Output: The first value, or "" when absent.
 * Use case: parseRbacListQuery.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * Description: Read a directory's search, status, role and page from the URL.
 * Input: Next's searchParams object (untrusted).
 * Output: A safe query: search trimmed and cut to 100 characters, status one of
 *   all/active/disabled, role a plain id string (the server still checks it),
 *   page clamped to 1..10 000.
 * Use case: Roles and sub-users list pages (server), so the toolbar and the
 *   query always agree.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function parseRbacListQuery(params: Record<string, string | string[] | undefined>): RbacListQuery {
  // Step 1: search text and status (unknown statuses fall back to "all").
  const q   = firstParam(params.q).trim().slice(0, RBAC_SEARCH_MAX_LENGTH);
  const raw = firstParam(params.status);

  const status: RbacStatusFilter = raw === "active" || raw === "disabled" ? raw : "all";

  // Step 2: role id (validated by the server) and a clamped page number.
  const role   = firstParam(params.role).trim().slice(0, 64);
  const parsed = Number.parseInt(firstParam(params.page), 10);
  const page   = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), RBAC_MAX_PAGE) : 1;
  return { q, status, role, page };
}

/**
 * Description: Build the URL of a directory state.
 * Input: The list page's path and the (partial) query.
 * Output: The path with only non-default parameters (q, status, role, page).
 * Use case: Toolbar, pagination links and "Clear filters".
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function rbacListHref(basePath: string, query: Partial<RbacListQuery>): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status && query.status !== "all") params.set("status", query.status);
  if (query.role) params.set("role", query.role);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const search = params.toString();
  return search ? `${basePath}?${search}` : basePath;
}

/**
 * Description: Tell whether a query narrows the list (search or filters set).
 * Input: The query.
 * Output: True when a search, a status other than "all" or a role is set.
 * Use case: Choosing between the "nothing yet" and "no match" empty states,
 *   and showing "Clear filters".
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function hasRbacFilters(query: RbacListQuery): boolean {
  return query.q !== "" || query.status !== "all" || query.role !== "";
}

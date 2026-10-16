import type { RegistrationListQuery } from "@/lib/workspace/rules";

/**
 * Description: Build the URL of a registrations list state.
 * Input: The list page's path and the search, status and page.
 * Output: The path with only non-default parameters (q, status, page), so
 *   filters survive reloads, Back and shared links (CLAUDE.md "filters in the URL").
 * Use case: Toolbar, pagination and "Clear filters".
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function registrationListHref(basePath: string, query: Partial<RegistrationListQuery>): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status && query.status !== "all") params.set("status", query.status);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const search = params.toString();
  return search ? `${basePath}?${search}` : basePath;
}

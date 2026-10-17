/**
 * Small display helpers shared by the RBAC components (client-safe, pure).
 */

/**
 * Description: Format an ISO date for RBAC lists.
 * Input: An ISO date-time string.
 * Output: e.g. "16 Oct 2026" (fixed locale and UTC, so server and client agree).
 * Use case: "Updated" / "Created" columns of the roles and sub-users directories.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function formatRbacDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(iso),
  );
}

/**
 * Description: Describe how many privileges a role grants.
 * Input: The count, or null for "all" (master roles), and the total of the
 *   panel's catalog when known (shown as "All (N)").
 * Output: "All privileges" / "All (N)", "1 privilege" or "N privileges".
 * Use case: Role picker option meta, roles directory privileges column.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function privilegeCountText(count: number | null, total?: number): string {
  if (count === null) return total === undefined ? "All privileges" : `All (${total})`;
  return count === 1 ? "1 privilege" : `${count} privileges`;
}

/**
 * Description: Pluralize a count with its noun.
 * Input: The count and the singular/plural nouns.
 * Output: e.g. "1 user", "3 users".
 * Use case: "N users affected", popup titles and calculations.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function countText(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Description: Format an ISO date for registration lists.
 * Input: An ISO date string.
 * Output: e.g. "16 Oct 2026" (stable across server and client: fixed locale and UTC).
 * Use case: Submitted / reviewed dates in tables, cards and popups.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function formatRegistrationDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(iso),
  );
}

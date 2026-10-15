/**
 * The one UUID format check of the application (CLAUDE.md "Reuse, Don't
 * Duplicate"). Pure: importable from server code, client components and tests.
 * Ids arrive from URLs, form fields and Server Action arguments; anything that
 * is not a UUID must never reach a uuid column or a storage path.
 */

/** A UUID in its canonical 8-4-4-4-12 hex form (any case). */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Description: Tell whether an untrusted value is a UUID string.
 * Input: Any value (from a URL, a form field or a Server Action argument).
 * Output: True (and the type narrowed to string) for a canonical UUID.
 * Use case: Tenant ids, owner ids and storage keys before they are used.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

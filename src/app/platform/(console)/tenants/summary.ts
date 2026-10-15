import "server-only";
import { describeError } from "@/lib/platform-auth/session";
import { getTenantSummary, type TenantSummary } from "@/lib/tenants/service";

/**
 * Description: Load the tenant figures for the summary cards.
 * Input: None.
 * Output: The summary, or null when it could not be read (the cards then say so
 *   instead of showing invented numbers; the cause goes to the server log).
 * Use case: Dashboard and tenant directory.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function loadTenantSummary(): Promise<TenantSummary | null> {
  try {
    return await getTenantSummary();
  } catch (error) {
    console.error(`[tenants] could not load the tenant summary: ${describeError(error)}`);
    return null;
  }
}

/** The note of a card whose figure could not be read. */
export const SUMMARY_UNAVAILABLE = "Couldn't load";

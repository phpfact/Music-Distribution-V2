import "server-only";
import { describeError } from "@/lib/platform-auth/session";
import { getTenantSummary, type TenantSummary } from "@/lib/tenants/service";

/**
 * The tenant figures for the dashboard and the list, or null when they could
 * not be read: the cards then say so instead of showing invented numbers.
 * The cause goes to the server log only.
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

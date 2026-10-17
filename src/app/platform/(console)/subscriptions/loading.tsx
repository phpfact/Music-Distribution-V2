import { ConsoleLoading } from "../_components/console-loading";

/**
 * Description: Show the generic console skeleton while this section loads.
 * Input: None (Next.js loading convention).
 * Output: The shared console loading state (same as before it moved out of
 *   the console-wide loading.tsx, which also wrapped the RBAC [id] pages).
 * Use case: /platform/subscriptions.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default function Loading() {
  return <ConsoleLoading />;
}

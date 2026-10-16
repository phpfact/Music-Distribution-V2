import { redirect } from "next/navigation";
import { TENANT_DASHBOARD_PATH } from "./navigation";

/**
 * Description: Send /tenant to the tenant dashboard.
 * Input: None.
 * Output: A redirect to /tenant/dashboard (which checks the session itself).
 * Use case: /tenant.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default function TenantIndexPage() {
  redirect(TENANT_DASHBOARD_PATH);
}

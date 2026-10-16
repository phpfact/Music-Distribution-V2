import { redirect } from "next/navigation";
import { TENANT_APPEARANCE_PATH } from "../navigation";

/**
 * Description: Send /tenant/settings to its only page, Appearance.
 * Input: None.
 * Output: A redirect to /tenant/settings/appearance (which checks the session itself).
 * Use case: /tenant/settings.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default function TenantSettingsPage() {
  redirect(TENANT_APPEARANCE_PATH);
}

import { redirect } from "next/navigation";
import { CUSTOMER_APPEARANCE_PATH } from "../navigation";

/**
 * Description: Send /customer/settings to its only page, Appearance.
 * Input: None.
 * Output: A redirect to /customer/settings/appearance (which checks the session itself).
 * Use case: /customer/settings.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default function CustomerSettingsPage() {
  redirect(CUSTOMER_APPEARANCE_PATH);
}

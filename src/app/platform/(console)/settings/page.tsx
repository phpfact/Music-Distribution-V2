import { redirect } from "next/navigation";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";

/**
 * Description: Send /platform/settings to its only section, Appearance.
 * Input: None (the session is checked first).
 * Output: A redirect to /platform/settings/appearance.
 * Use case: /platform/settings and the account menu's Platform settings link.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export default async function SettingsPage() {
  await requirePlatformOwner();
  redirect("/platform/settings/appearance");
}

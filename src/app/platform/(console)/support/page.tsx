import type { Metadata } from "next";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { ComingSoon } from "../_components/coming-soon";
import { getNavItem } from "../navigation";

export const metadata: Metadata = { title: getNavItem("support").label };

/**
 * Description: Render the planned Support module page.
 * Input: None (the session is checked on the server).
 * Output: The Coming soon page for support.
 * Use case: /platform/support.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export default async function PlatformSupportPage() {
  await requirePlatformOwner();
  return <ComingSoon id="support" />;
}

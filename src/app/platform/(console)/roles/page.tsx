import type { Metadata } from "next";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { ComingSoon } from "../_components/coming-soon";
import { getNavItem } from "../navigation";

export const metadata: Metadata = { title: getNavItem("roles").label };

/**
 * Description: Render the planned Roles & Permissions module page.
 * Input: None (the session is checked on the server).
 * Output: The Coming soon page for roles.
 * Use case: /platform/roles.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export default async function PlatformRolesPage() {
  await requirePlatformOwner();
  return <ComingSoon id="roles" />;
}

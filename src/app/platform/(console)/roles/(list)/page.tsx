import type { Metadata } from "next";
import { getNavItem } from "@/app/platform/(console)/navigation";
import { RolesListScreen } from "@/components/rbac/screens/roles-screens";
import { PLATFORM_ROLE_SCREENS } from "@/app/platform/(console)/rbac-bindings";

export const metadata: Metadata = { title: getNavItem("roles").label };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Description: The Platform panel's roles list (UI spec "Roles list").
 * Input: The URL's search, status, page and one-off notice (anyone can edit them).
 * Output: The shared roles list: without platform.roles.view the inline access-denied state (HTTP 200,
 *   nothing read); otherwise the roles of this panel's scope with the actions the
 *   viewer's platform.roles.create|edit|delete privileges allow (decided by the screen).
 * Use case: /platform/roles.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
export default async function PlatformRolesPage({ searchParams }: PageProps) {
  return <RolesListScreen binding={PLATFORM_ROLE_SCREENS} searchParams={await searchParams} />;
}

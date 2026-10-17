import type { Metadata } from "next";
import { getNavItem } from "@/app/platform/(console)/navigation";
import { SubUsersListScreen } from "@/components/rbac/screens/sub-users-screens";
import { SUB_PLATFORM_OWNER_SCREENS } from "@/app/platform/(console)/rbac-bindings";

export const metadata: Metadata = { title: getNavItem("users").label };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Description: The Platform panel's Sub-Platform Owners list (UI spec "Sub-users list").
 * Input: The URL's search, status, role, page and one-off notice (anyone can edit them).
 * Output: The shared sub-users list: without platform.users.view the inline access-denied state
 *   (HTTP 200, nothing read); otherwise the accounts of this panel's scope with the
 *   actions the viewer's platform.users.create|edit|suspend privileges allow.
 * Use case: /platform/users.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function PlatformSubUsersPage({ searchParams }: PageProps) {
  return <SubUsersListScreen binding={SUB_PLATFORM_OWNER_SCREENS} searchParams={await searchParams} />;
}

import type { Metadata } from "next";
import { RoleDetailsScreen } from "@/components/rbac/screens/roles-screens";
import { PLATFORM_ROLE_SCREENS } from "@/app/platform/(console)/rbac-bindings";

export const metadata: Metadata = { title: "Role details" };

// No loading.tsx on this route (and the list's skeleton lives in the `(list)` route
// group) on purpose: a Suspense boundary above this page would stream the shell
// first, and notFound() (unknown / malformed / foreign id) would then answer HTTP
// 200 instead of 404. Client navigation keeps the previous page until it is ready.

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Description: The Platform panel's role details page (UI spec "Role details").
 * Input: The role id from the URL (untrusted) and the one-off notice.
 * Output: The shared details screen: without platform.roles.view the access-denied state; an
 *   unknown, malformed or out-of-scope id answers HTTP 404; otherwise Overview,
 *   Privileges and Assigned users with the actions the viewer may use on this role.
 *   The title is fixed, so the role's name never reaches the tab title of someone without access.
 * Use case: /platform/roles/[id].
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function PlatformRoleDetailsPage({ params, searchParams }: PageProps) {
  return <RoleDetailsScreen binding={PLATFORM_ROLE_SCREENS} roleId={(await params).id} searchParams={await searchParams} />;
}

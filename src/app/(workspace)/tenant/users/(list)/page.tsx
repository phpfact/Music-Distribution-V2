import type { Metadata } from "next";
import { SubUsersListScreen } from "@/components/rbac/screens/sub-users-screens";
import { SUB_TENANT_SCREENS } from "@/app/(workspace)/tenant/rbac-bindings";

export const metadata: Metadata = { title: "Sub-Tenants" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Description: The Tenant panel's Sub-Tenants list (UI spec "Sub-users list").
 * Input: The URL's search, status, role, page and one-off notice (anyone can edit them).
 * Output: The shared sub-users list: without tenant.users.view the inline access-denied state
 *   (HTTP 200, nothing read); otherwise the accounts of this panel's scope with the
 *   actions the viewer's tenant.users.create|edit|suspend privileges allow.
 * Use case: /tenant/users.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function SubTenantsPage({ searchParams }: PageProps) {
  return <SubUsersListScreen binding={SUB_TENANT_SCREENS} searchParams={await searchParams} />;
}

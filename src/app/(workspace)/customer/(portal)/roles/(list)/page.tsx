import type { Metadata } from "next";
import { RolesListScreen } from "@/components/rbac/screens/roles-screens";
import { CUSTOMER_ROLE_SCREENS } from "@/app/(workspace)/customer/(portal)/rbac-bindings";

export const metadata: Metadata = { title: "Roles & Privileges" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Description: The Customer panel's roles list (UI spec "Roles list").
 * Input: The URL's search, status, page and one-off notice (anyone can edit them).
 * Output: The shared roles list: without customer.roles.view the inline access-denied state (HTTP 200,
 *   nothing read); otherwise the roles of this panel's scope with the actions the
 *   viewer's customer.roles.create|edit|delete privileges allow (decided by the screen).
 * Use case: /customer/roles.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function CustomerRolesPage({ searchParams }: PageProps) {
  return <RolesListScreen binding={CUSTOMER_ROLE_SCREENS} searchParams={await searchParams} />;
}

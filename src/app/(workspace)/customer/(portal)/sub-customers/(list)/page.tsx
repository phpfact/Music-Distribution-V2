import type { Metadata } from "next";
import { SubUsersListScreen } from "@/components/rbac/screens/sub-users-screens";
import { SUB_CUSTOMER_SCREENS } from "@/app/(workspace)/customer/(portal)/rbac-bindings";

export const metadata: Metadata = { title: "Sub-Customers" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Description: The Customer panel's Sub-Customers list (UI spec "Sub-users list").
 * Input: The URL's search, status, role, page and one-off notice (anyone can edit them).
 * Output: The shared sub-users list: without customer.sub_customers.view the inline access-denied state
 *   (HTTP 200, nothing read); otherwise the accounts of this panel's scope with the
 *   actions the viewer's customer.sub_customers.create|edit|suspend privileges allow.
 * Use case: /customer/sub-customers.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function SubCustomersPage({ searchParams }: PageProps) {
  return <SubUsersListScreen binding={SUB_CUSTOMER_SCREENS} searchParams={await searchParams} />;
}

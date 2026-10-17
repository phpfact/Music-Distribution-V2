import type { Metadata } from "next";
import { SubUserFormScreen } from "@/components/rbac/screens/sub-users-screens";
import { SUB_CUSTOMER_SCREENS } from "@/app/(workspace)/customer/(portal)/rbac-bindings";

export const metadata: Metadata = { title: "Add Sub-Customer" };

/**
 * Description: The Customer panel's create page of a Sub-Customer (UI spec "Sub-user form").
 * Input: None.
 * Output: The shared sub-user form: without customer.sub_customers.create the access-denied state; otherwise
 *   the form with the roles the viewer may assign (exactly one is submitted).
 * Use case: /customer/sub-customers/new.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function NewSubCustomerPage() {
  return <SubUserFormScreen binding={SUB_CUSTOMER_SCREENS} mode="create" />;
}

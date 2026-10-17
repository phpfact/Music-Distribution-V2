import type { Metadata } from "next";
import { RoleEditorScreen } from "@/components/rbac/screens/roles-screens";
import { CUSTOMER_ROLE_SCREENS } from "@/app/(workspace)/customer/(portal)/rbac-bindings";

export const metadata: Metadata = { title: "Create role" };

/**
 * Description: The Customer panel's create-role page (UI spec "Role editor").
 * Input: None.
 * Output: The shared role editor: without customer.roles.create the access-denied state; otherwise
 *   only the privileges the viewer may grant as checkboxes (the rest locked).
 * Use case: /customer/roles/new.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function NewCustomerRolePage() {
  return <RoleEditorScreen binding={CUSTOMER_ROLE_SCREENS} mode="create" />;
}

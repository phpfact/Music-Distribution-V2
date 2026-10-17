import type { Metadata } from "next";
import { SubUserFormScreen } from "@/components/rbac/screens/sub-users-screens";
import { SUB_TENANT_SCREENS } from "@/app/(workspace)/tenant/rbac-bindings";

export const metadata: Metadata = { title: "Add Sub-Tenant" };

/**
 * Description: The Tenant panel's create page of a Sub-Tenant (UI spec "Sub-user form").
 * Input: None.
 * Output: The shared sub-user form: without tenant.users.create the access-denied state; otherwise
 *   the form with the roles the viewer may assign (exactly one is submitted).
 * Use case: /tenant/users/new.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function NewSubTenantPage() {
  return <SubUserFormScreen binding={SUB_TENANT_SCREENS} mode="create" />;
}

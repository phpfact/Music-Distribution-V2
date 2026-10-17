import type { Metadata } from "next";
import { RoleEditorScreen } from "@/components/rbac/screens/roles-screens";
import { TENANT_ROLE_SCREENS } from "@/app/(workspace)/tenant/rbac-bindings";

export const metadata: Metadata = { title: "Create role" };

/**
 * Description: The Tenant panel's create-role page (UI spec "Role editor").
 * Input: None.
 * Output: The shared role editor: without tenant.roles.create the access-denied state; otherwise
 *   only the privileges the viewer may grant as checkboxes (the rest locked).
 * Use case: /tenant/roles/new.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function NewTenantRolePage() {
  return <RoleEditorScreen binding={TENANT_ROLE_SCREENS} mode="create" />;
}

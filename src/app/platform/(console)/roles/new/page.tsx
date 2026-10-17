import type { Metadata } from "next";
import { RoleEditorScreen } from "@/components/rbac/screens/roles-screens";
import { PLATFORM_ROLE_SCREENS } from "@/app/platform/(console)/rbac-bindings";

export const metadata: Metadata = { title: "Create role" };

/**
 * Description: The Platform panel's create-role page (UI spec "Role editor").
 * Input: None.
 * Output: The shared role editor: without platform.roles.create the access-denied state; otherwise
 *   only the privileges the viewer may grant as checkboxes (the rest locked).
 * Use case: /platform/roles/new.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function CreatePlatformRolePage() {
  return <RoleEditorScreen binding={PLATFORM_ROLE_SCREENS} mode="create" />;
}

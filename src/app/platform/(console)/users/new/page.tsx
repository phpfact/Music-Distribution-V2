import type { Metadata } from "next";
import { SubUserFormScreen } from "@/components/rbac/screens/sub-users-screens";
import { SUB_PLATFORM_OWNER_SCREENS } from "@/app/platform/(console)/rbac-bindings";

export const metadata: Metadata = { title: "Add Sub-Platform Owner" };

/**
 * Description: The Platform panel's create page of a Sub-Platform Owner (UI spec "Sub-user form").
 * Input: None.
 * Output: The shared sub-user form: without platform.users.create the access-denied state; otherwise
 *   the form with the roles the viewer may assign (exactly one is submitted).
 * Use case: /platform/users/new.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function CreateSubPlatformOwnerPage() {
  return <SubUserFormScreen binding={SUB_PLATFORM_OWNER_SCREENS} mode="create" />;
}

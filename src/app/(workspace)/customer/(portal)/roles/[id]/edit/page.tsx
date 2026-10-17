import type { Metadata } from "next";
import { RoleEditorScreen } from "@/components/rbac/screens/roles-screens";
import { CUSTOMER_ROLE_SCREENS } from "@/app/(workspace)/customer/(portal)/rbac-bindings";

export const metadata: Metadata = { title: "Edit role" };

// No loading.tsx on this route (and the list's skeleton lives in the `(list)` route
// group) on purpose: a Suspense boundary above this page would stream the shell
// first, and notFound() (unknown / malformed / foreign id) would then answer HTTP
// 200 instead of 404. Client navigation keeps the previous page until it is ready.

type PageProps = { params: Promise<{ id: string }> };

/**
 * Description: The Customer panel's edit-role page (UI spec "Role editor").
 * Input: The role id from the URL (untrusted).
 * Output: The shared role editor: without customer.roles.edit the access-denied state; unknown,
 *   malformed or out-of-scope id → HTTP 404; a role the viewer may not manage (system
 *   role, own role, above the ceiling) → the access-denied state with the reason;
 *   otherwise the prefilled editor.
 * Use case: /customer/roles/[id]/edit.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function EditCustomerRolePage({ params }: PageProps) {
  return <RoleEditorScreen binding={CUSTOMER_ROLE_SCREENS} mode="edit" roleId={(await params).id} />;
}

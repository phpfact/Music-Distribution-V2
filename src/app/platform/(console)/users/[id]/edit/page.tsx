import type { Metadata } from "next";
import { SubUserFormScreen } from "@/components/rbac/screens/sub-users-screens";
import { SUB_PLATFORM_OWNER_SCREENS } from "@/app/platform/(console)/rbac-bindings";

export const metadata: Metadata = { title: "Edit Sub-Platform Owner" };

// No loading.tsx on this route (and the list's skeleton lives in the `(list)` route
// group) on purpose: a Suspense boundary above this page would stream the shell
// first, and notFound() (unknown / malformed / foreign id) would then answer HTTP
// 200 instead of 404. Client navigation keeps the previous page until it is ready.

type PageProps = { params: Promise<{ id: string }> };

/**
 * Description: The Platform panel's edit page of one Sub-Platform Owner (UI spec "Sub-user form").
 * Input: The user id from the URL (untrusted).
 * Output: The shared sub-user form: without platform.users.edit the access-denied state; unknown,
 *   malformed or out-of-scope id → HTTP 404; an account the viewer may not manage (own,
 *   primary, above the ceiling) → the access-denied state with the reason; otherwise
 *   the prefilled form.
 * Use case: /platform/users/[id]/edit.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function EditSubPlatformOwnerPage({ params }: PageProps) {
  return <SubUserFormScreen binding={SUB_PLATFORM_OWNER_SCREENS} mode="edit" userId={(await params).id} />;
}

import { RbacFormSkeleton } from "@/components/rbac/screens/skeletons";
import { PLATFORM_ROLE_SCREENS } from "@/app/platform/(console)/rbac-bindings";

/**
 * Description: Show a skeleton shaped like the form while it loads.
 * Input: None (Next.js loading convention).
 * Output: An accessible "Loading" status (header, section menu, form sections).
 * Use case: /platform/roles/new.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default function Loading() {
  return <RbacFormSkeleton gutterClassName={PLATFORM_ROLE_SCREENS.gutterClassName} />;
}

import { RbacListSkeleton } from "@/components/rbac/screens/skeletons";
import { PLATFORM_ROLE_SCREENS } from "@/app/platform/(console)/rbac-bindings";

/**
 * Description: Show a skeleton shaped like the roles list while it loads.
 * Input: None (Next.js loading convention).
 * Output: An accessible "Loading" status (four figures, toolbar, rows).
 * Use case: /platform/roles.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default function Loading() {
  return <RbacListSkeleton figures={4} gutterClassName={PLATFORM_ROLE_SCREENS.gutterClassName} />;
}

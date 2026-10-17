import { RbacListSkeleton } from "@/components/rbac/screens/skeletons";
import { SUB_PLATFORM_OWNER_SCREENS } from "@/app/platform/(console)/rbac-bindings";

/**
 * Description: Show a skeleton shaped like the sub-users list while it loads.
 * Input: None (Next.js loading convention).
 * Output: An accessible "Loading" status (three figures, toolbar, rows).
 * Use case: /platform/users.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default function Loading() {
  return <RbacListSkeleton figures={3} gutterClassName={SUB_PLATFORM_OWNER_SCREENS.gutterClassName} />;
}

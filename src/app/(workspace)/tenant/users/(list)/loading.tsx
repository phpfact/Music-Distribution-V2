import { RbacListSkeleton } from "@/components/rbac/screens/skeletons";
import { SUB_TENANT_SCREENS } from "@/app/(workspace)/tenant/rbac-bindings";

/**
 * Description: Show a skeleton shaped like the sub-users list while it loads.
 * Input: None (Next.js loading convention).
 * Output: An accessible "Loading" status (three figures, toolbar, rows).
 * Use case: /tenant/users.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default function SubTenantsLoading() {
  return <RbacListSkeleton figures={3} gutterClassName={SUB_TENANT_SCREENS.gutterClassName} />;
}

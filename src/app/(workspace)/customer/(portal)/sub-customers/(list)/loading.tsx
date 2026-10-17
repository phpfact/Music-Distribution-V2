import { RbacListSkeleton } from "@/components/rbac/screens/skeletons";
import { SUB_CUSTOMER_SCREENS } from "@/app/(workspace)/customer/(portal)/rbac-bindings";

/**
 * Description: Show a skeleton shaped like the sub-users list while it loads.
 * Input: None (Next.js loading convention).
 * Output: An accessible "Loading" status (three figures, toolbar, rows).
 * Use case: /customer/sub-customers.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default function SubCustomersLoading() {
  return <RbacListSkeleton figures={3} gutterClassName={SUB_CUSTOMER_SCREENS.gutterClassName} />;
}

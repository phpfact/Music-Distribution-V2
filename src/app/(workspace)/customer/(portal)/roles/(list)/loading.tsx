import { RbacListSkeleton } from "@/components/rbac/screens/skeletons";
import { CUSTOMER_ROLE_SCREENS } from "@/app/(workspace)/customer/(portal)/rbac-bindings";

/**
 * Description: Show a skeleton shaped like the roles list while it loads.
 * Input: None (Next.js loading convention).
 * Output: An accessible "Loading" status (four figures, toolbar, rows).
 * Use case: /customer/roles.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default function CustomerRolesLoading() {
  return <RbacListSkeleton figures={4} gutterClassName={CUSTOMER_ROLE_SCREENS.gutterClassName} />;
}

import { RbacFormSkeleton } from "@/components/rbac/screens/skeletons";
import { CUSTOMER_ROLE_SCREENS } from "@/app/(workspace)/customer/(portal)/rbac-bindings";

/**
 * Description: Show a skeleton shaped like the form while it loads.
 * Input: None (Next.js loading convention).
 * Output: An accessible "Loading" status (header, section menu, form sections).
 * Use case: /customer/roles/new.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default function NewCustomerRoleLoading() {
  return <RbacFormSkeleton gutterClassName={CUSTOMER_ROLE_SCREENS.gutterClassName} />;
}

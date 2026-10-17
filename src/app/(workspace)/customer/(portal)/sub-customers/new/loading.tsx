import { RbacFormSkeleton } from "@/components/rbac/screens/skeletons";
import { SUB_CUSTOMER_SCREENS } from "@/app/(workspace)/customer/(portal)/rbac-bindings";

/**
 * Description: Show a skeleton shaped like the form while it loads.
 * Input: None (Next.js loading convention).
 * Output: An accessible "Loading" status (header, section menu, form sections).
 * Use case: /customer/sub-customers/new.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default function NewSubCustomerLoading() {
  return <RbacFormSkeleton gutterClassName={SUB_CUSTOMER_SCREENS.gutterClassName} />;
}

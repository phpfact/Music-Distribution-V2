import { RbacFormSkeleton } from "@/components/rbac/screens/skeletons";
import { TENANT_ROLE_SCREENS } from "@/app/(workspace)/tenant/rbac-bindings";

/**
 * Description: Show a skeleton shaped like the form while it loads.
 * Input: None (Next.js loading convention).
 * Output: An accessible "Loading" status (header, section menu, form sections).
 * Use case: /tenant/roles/new.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default function NewTenantRoleLoading() {
  return <RbacFormSkeleton gutterClassName={TENANT_ROLE_SCREENS.gutterClassName} />;
}

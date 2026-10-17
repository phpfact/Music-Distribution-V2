import { RbacListSkeleton } from "@/components/rbac/screens/skeletons";
import { TENANT_ROLE_SCREENS } from "@/app/(workspace)/tenant/rbac-bindings";

/**
 * Description: Show a skeleton shaped like the roles list while it loads.
 * Input: None (Next.js loading convention).
 * Output: An accessible "Loading" status (four figures, toolbar, rows).
 * Use case: /tenant/roles.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default function TenantRolesLoading() {
  return <RbacListSkeleton figures={4} gutterClassName={TENANT_ROLE_SCREENS.gutterClassName} />;
}

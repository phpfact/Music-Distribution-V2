import { RbacListSkeleton } from "@/components/rbac/screens/skeletons";
import { TENANT_CUSTOMERS_GUTTER } from "../screen";

/**
 * Description: Show a skeleton shaped like the customers list while it loads.
 * Input: None (Next.js loading convention).
 * Output: An accessible "Loading" status (three figures, toolbar, rows).
 * Use case: /tenant/customers.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export default function TenantCustomersLoading() {
  return <RbacListSkeleton figures={3} gutterClassName={TENANT_CUSTOMERS_GUTTER} />;
}

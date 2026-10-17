import type { Metadata } from "next";
import { CustomerForm } from "@/components/customers/customer-form";
import { DeniedScreen, ScreenFrame } from "@/components/rbac/screens/screen-parts";
import { requireTenantAccess } from "@/lib/authz/workspace";
import { TENANT_CUSTOMERS_PATH, TENANT_DASHBOARD_PATH } from "../../navigation";
import { createTenantCustomerAction } from "../actions";
import { TENANT_CUSTOMERS_EYEBROW, TENANT_CUSTOMERS_GUTTER } from "../screen";

export const metadata: Metadata = { title: "Add customer" };

/**
 * Description: The tenant's "Add customer" page (.vibe/memory/customer-management.md).
 * Input: None.
 * Output: Without tenant.customers.create the inline access-denied state (HTTP
 *   200); otherwise the sectioned "Add customer" form (Personal Information,
 *   Login Information, Access) bound to createTenantCustomerAction, which
 *   checks the privilege again and redirects to the list on success.
 * Use case: /tenant/customers/new.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export default async function NewTenantCustomerPage() {
  // Step 1: a signed-in staff user of this host with the CURRENT create privilege.
  const area = await requireTenantAccess();
  if (!area.authz.can("tenant.customers.create")) {
    return <DeniedScreen gutterClassName={TENANT_CUSTOMERS_GUTTER} homeHref={TENANT_DASHBOARD_PATH} />;
  }

  // Step 2: the form; nothing protected is read for it.
  return (
    <ScreenFrame
      gutterClassName={TENANT_CUSTOMERS_GUTTER}
      eyebrow={TENANT_CUSTOMERS_EYEBROW}
      title="Add customer"
      description="The customer can log in as soon as the account is created. No approval is needed."
      backHref={TENANT_CUSTOMERS_PATH}
      backLabel="Customers"
    >
      <CustomerForm action={createTenantCustomerAction} cancelHref={TENANT_CUSTOMERS_PATH} />
    </ScreenFrame>
  );
}

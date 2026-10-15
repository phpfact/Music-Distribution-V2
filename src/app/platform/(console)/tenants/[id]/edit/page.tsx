import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { getTenantForEdit } from "@/lib/tenants/service";
import { PageHeader } from "../../../_components/page-header";
import { TENANTS_PATH } from "../../list-query";
import { EditTenantForm } from "./edit-tenant-form";

type PageProps = { params: Promise<{ id: string }> };

// Memoized for one request: the metadata and the page read the tenant once.
const loadTenant = cache(async (id: string) => getTenantForEdit(id));

/**
 * Description: Load an authenticated tenant title without exposing data to signed-out visitors.
 * Input: The existing typed arguments and component state.
 * Output: The existing helper result or state update.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  // No tenant data in the title without a session.
  await requirePlatformOwner();
  const tenant = await loadTenant((await params).id);
  return { title: tenant ? `Edit ${tenant.fullName}` : "Tenant not found" };
}

/**
 * Description: Load saved tenant values into the protected edit page.
 * Input: The existing typed arguments and component state.
 * Output: Accessible React UI.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
export default async function EditTenantPage({ params }: PageProps) {
  // Checked on the server on every request; nothing below renders without it.
  await requirePlatformOwner();
  const tenant = await loadTenant((await params).id);
  if (!tenant) notFound();

  const detailsHref = `${TENANTS_PATH}/${tenant.id}`;

  return (
    // Centred and capped like the create page, so both forms look the same.
    <div className="relative mx-auto flex w-full max-w-4xl flex-col gap-8">
      <PageHeader
        backHref={detailsHref}
        backLabel={tenant.fullName}
        eyebrow="Platform management"
        title="Edit tenant"
        description="Change the tenant's profile, admin login and domains. Credentials are changed on the tenant page."
      />

      <EditTenantForm tenant={tenant} />
    </div>
  );
}

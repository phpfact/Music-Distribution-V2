import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { getTenantForEdit } from "@/lib/tenants/service";
import type { IconName } from "../../../_components/icons";
import { PageHeader } from "../../../_components/page-header";
import { SectionedLayout, type SecondaryMenuItem } from "../../../_components/secondary-menu";
import { TENANTS_PATH } from "../../list-query";
import { EDIT_SECTIONS, type EditSectionId } from "./edit-model";
import { EditTenantForm } from "./edit-tenant-form";

type PageProps = { params: Promise<{ id: string }> };

// The symbol of each form category in the secondary menu (same as the section headers).
const SECTION_ICONS: Readonly<Record<EditSectionId, IconName>> = {
  profile: "user",
  login:   "key-round",
  domain:  "globe",
};

// The secondary menu: one item per form category, in form order.
const MENU_ITEMS: readonly SecondaryMenuItem[] = EDIT_SECTIONS.map((section) => ({
  id: section.anchor,
  label: section.title,
  icon: SECTION_ICONS[section.id],
}));

/**
 * Description: Load the tenant once per request for the metadata and the page.
 * Input: The tenant id from the URL.
 * Output: The tenant as loaded for editing, or null when there is none.
 * Use case: generateMetadata and EditTenantPage (React cache: one database read).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
const loadTenant = cache(async (id: string) => getTenantForEdit(id));

/**
 * Description: Build the edit page's title without exposing data to signed-out visitors.
 * Input: The route parameters (tenant id).
 * Output: "Edit <name>", or "Tenant not found"; a signed-out visitor is redirected first.
 * Use case: The browser tab title of /platform/tenants/<id>/edit.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
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
 * Description: Render the protected edit-tenant page.
 * Input: The route parameters (tenant id).
 * Output: The page header, the secondary menu (Personal, Login and Domain
 *   Information) and the edit form prefilled with the saved values; 404 when
 *   the tenant does not exist.
 * Use case: /platform/tenants/<id>/edit — the owner changes a tenant's details.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export default async function EditTenantPage({ params }: PageProps) {
  // Checked on the server on every request; nothing below renders without it.
  await requirePlatformOwner();
  const tenant = await loadTenant((await params).id);
  if (!tenant) notFound();

  const detailsHref = `${TENANTS_PATH}/${tenant.id}`;

  return (
    // Centred and capped like the create page, so both forms look the same.
    <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-8">
      <PageHeader
        backHref={detailsHref}
        backLabel={tenant.fullName}
        eyebrow="Platform management"
        title="Edit tenant"
        description="Change the tenant's profile, admin login and domains. Credentials are changed on the tenant page."
      />

      <SectionedLayout items={MENU_ITEMS} label="Form sections">
        <EditTenantForm tenant={tenant} />
      </SectionedLayout>
    </div>
  );
}

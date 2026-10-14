import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { getTenantForEdit } from "@/lib/tenants/service";
import { Icon } from "../../../_components/icons";
import { FOCUS_RING } from "../../../_components/styles";
import { TENANTS_PATH } from "../../list-query";
import { EditTenantForm } from "./edit-tenant-form";

type PageProps = { params: Promise<{ id: string }> };

// Memoized for one request: the metadata and the page read the tenant once.
const loadTenant = cache(async (id: string) => getTenantForEdit(id));

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  // No tenant data in the title without a session.
  await requirePlatformOwner();
  const tenant = await loadTenant((await params).id);
  return { title: tenant ? `Edit ${tenant.fullName}` : "Tenant not found" };
}

export default async function EditTenantPage({ params }: PageProps) {
  // Checked on the server on every request; nothing below renders without it.
  await requirePlatformOwner();
  const tenant = await loadTenant((await params).id);
  if (!tenant) notFound();

  const detailsHref = `${TENANTS_PATH}/${tenant.id}`;

  return (
    <div className="flex w-full max-w-3xl flex-col gap-8">
      <header className="flex min-w-0 flex-col gap-2">
        <Link
          href={detailsHref}
          className={`inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-medium text-fg-muted transition-colors hover:text-fg ${FOCUS_RING}`}
        >
          <Icon name="arrow-left" className="size-4" />
          <span className="break-all">{tenant.fullName}</span>
        </Link>
        <p className="mt-2 text-xs font-medium tracking-wider text-accent uppercase">
          Platform management
        </p>
        <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">Edit tenant</h1>
        <p className="text-fg-muted">
          Change the tenant&apos;s profile, admin login and domains. Credentials are changed on the
          tenant page.
        </p>
      </header>

      <EditTenantForm tenant={tenant} />
    </div>
  );
}

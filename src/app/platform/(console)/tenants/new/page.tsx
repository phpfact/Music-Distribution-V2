import type { Metadata } from "next";
import { getEnv } from "@/lib/env";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { PageHeader } from "../../_components/page-header";
import { CreateTenantForm } from "./create-tenant-form";

export const metadata: Metadata = { title: "Create tenant" };

/**
 * Description: Load safe public configuration into the protected creation page.
 * Input: The existing typed arguments and component state.
 * Output: Accessible React UI.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
export default async function CreateTenantPage() {
  // Checked on the server on every request; nothing below renders without it.
  await requirePlatformOwner();
  // Only what the form displays reaches the browser: never the control-plane
  // database name or the admin login (the server rejects those names itself).
  const { postgres, platformBaseDomain } = getEnv();

  // `relative` contains the form's many sr-only (absolutely positioned) texts:
  // the console scrolls inside its own container, and without a positioned
  // ancestor they would stretch the document below it.
  return (
    // Centred and capped so the two-column fields stay readable on wide screens.
    <div className="relative mx-auto flex w-full max-w-4xl flex-col gap-8">
      <PageHeader
        backHref="/platform/tenants"
        backLabel="Tenants"
        eyebrow="Platform management"
        title="Create tenant"
        description="Set up a new tenant with its own admin login, database and subdomain. Each section can generate its values for you or take what you type."
      />

      <CreateTenantForm
        baseDomain={platformBaseDomain}
        defaultPort={postgres.port}
        hostLabel={postgres.host}
      />
    </div>
  );
}

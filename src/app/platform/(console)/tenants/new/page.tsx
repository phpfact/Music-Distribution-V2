import type { Metadata } from "next";
import Link from "next/link";
import { getEnv } from "@/lib/env";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { Icon } from "../../_components/icons";
import { FOCUS_RING } from "../../_components/styles";
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
    <div className="relative flex w-full max-w-3xl flex-col gap-8">
      <header className="flex min-w-0 flex-col gap-2">
        <Link
          href="/platform/tenants"
          className={`inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-medium text-fg-muted transition-colors hover:text-fg ${FOCUS_RING}`}
        >
          <Icon name="arrow-left" className="size-4" />
          Tenants
        </Link>
        <p className="mt-2 text-xs font-medium tracking-wider text-primary uppercase">
          Platform management
        </p>
        <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">
          Create tenant
        </h1>
        <p className="text-fg-muted">
          Set up a new tenant with its own admin login, database and subdomain.
        </p>
      </header>

      <CreateTenantForm
        baseDomain={platformBaseDomain}
        defaultPort={postgres.port}
        hostLabel={postgres.host}
      />
    </div>
  );
}

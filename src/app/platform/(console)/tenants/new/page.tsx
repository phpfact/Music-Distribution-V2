import type { Metadata } from "next";
import { getEnv } from "@/lib/env";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import type { IconName } from "../../_components/icons";
import { PageHeader } from "../../_components/page-header";
import { SectionedLayout, type SecondaryMenuItem } from "../../_components/secondary-menu";
import { CreateTenantForm } from "./create-tenant-form";
import { FORM_SECTIONS, type FormSectionId } from "./form-model";

export const metadata: Metadata = { title: "Create tenant" };

// The symbol of each form category in the secondary menu (same as the section headers).
const SECTION_ICONS: Readonly<Record<FormSectionId, IconName>> = {
  profile:  "user",
  login:    "key-round",
  database: "database",
  domain:   "globe",
};

// The secondary menu: one item per form category, in form order.
const MENU_ITEMS: readonly SecondaryMenuItem[] = FORM_SECTIONS.map((section) => ({
  id: section.anchor,
  label: section.title,
  icon: SECTION_ICONS[section.id],
}));

/**
 * Description: Render the protected create-tenant page.
 * Input: None (the session is checked and safe configuration is read on the server).
 * Output: The page header, the secondary menu (Personal, Login, Database and
 *   Domain Information) and the create form with the base domain, default
 *   port and database server it displays.
 * Use case: /platform/tenants/new — the owner creates a tenant.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
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
    // Centred and capped so the two-column fields stay readable beside the menu.
    <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-8">
      <PageHeader
        backHref="/platform/tenants"
        backLabel="Tenants"
        eyebrow="Platform management"
        title="Create tenant"
        description="Set up a new tenant with its own admin login, database and subdomain. Each section can generate its values for you or take what you type."
      />

      {/* The menu hides itself once the form is replaced by the success panel. */}
      <SectionedLayout items={MENU_ITEMS} label="Form sections">
        <CreateTenantForm
          baseDomain={platformBaseDomain}
          defaultPort={postgres.port}
          hostLabel={postgres.host}
        />
      </SectionedLayout>
    </div>
  );
}

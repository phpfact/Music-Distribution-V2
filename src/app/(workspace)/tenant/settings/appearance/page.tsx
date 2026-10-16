import type { Metadata } from "next";
import { PageHeading } from "@/components/dashboard/page-heading";
import { AppearanceSettings } from "@/components/workspace/appearance-settings";
import { getViewerAppearanceState } from "@/lib/workspace/appearance";
import { requireTenantUser } from "@/lib/workspace/guards";
import { saveTenantAppearanceAction } from "../../actions";

export const metadata: Metadata = { title: "Appearance" };

/**
 * Description: Render the tenant staff user's Appearance settings.
 * Input: None (tenant from the Host header, user from the tenant area session).
 * Output: The settings with the user's saved state; the owner also manages the
 *   workspace default for all of this tenant's users (checked on the server).
 * Use case: /tenant/settings/appearance.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function TenantAppearancePage() {
  const area  = await requireTenantUser();
  const state = await getViewerAppearanceState(area.db, { userId: area.user.id, isOwner: area.user.isOwner });

  return (
    <>
      <PageHeading
        title="Appearance"
        description={
          area.user.isOwner
            ? "Choose how your dashboard looks, and set the default for everyone in your workspace."
            : "Choose how your dashboard looks."
        }
      />
      <div className="px-4 lg:px-6">
        <AppearanceSettings state={state} saveAction={saveTenantAppearanceAction} />
      </div>
    </>
  );
}

import type { Metadata } from "next";
import { PageHeading } from "@/components/dashboard/page-heading";
import { AppearanceSettings } from "@/components/workspace/appearance-settings";
import { getViewerAppearanceState } from "@/lib/workspace/appearance";
import { requireTenantAccess } from "@/lib/authz/workspace";
import { saveTenantAppearanceAction } from "../../actions";

export const metadata: Metadata = { title: "Appearance" };

/**
 * Description: Render the tenant staff user's Appearance settings.
 * Input: None (tenant from the Host header, user from the tenant area session).
 * Output: The settings with the user's saved state (personal appearance is
 *   available to every signed-in user); with tenant.appearance.manage_workspace
 *   the user also manages the workspace default for all of this tenant's users
 *   (checked again by the save action).
 * Use case: /tenant/settings/appearance.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function TenantAppearancePage() {
  const area               = await requireTenantAccess();
  const canManageWorkspace = area.authz.can("tenant.appearance.manage_workspace");
  const state              = await getViewerAppearanceState(area.db, { userId: area.user.id, canManageWorkspace });

  return (
    <>
      <PageHeading
        title="Appearance"
        description={
          canManageWorkspace
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

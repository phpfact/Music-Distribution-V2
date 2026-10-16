import type { Metadata } from "next";
import { PageHeading } from "@/components/dashboard/page-heading";
import { AppearanceSettings } from "@/components/workspace/appearance-settings";
import { getViewerAppearanceState } from "@/lib/workspace/appearance";
import { requireCustomer } from "@/lib/workspace/guards";
import { saveCustomerAppearanceAction } from "../../actions";

export const metadata: Metadata = { title: "Appearance" };

/**
 * Description: Render the customer's Appearance settings (personal only).
 * Input: None (tenant from the Host header, customer from the customer area session).
 * Output: The settings with the customer's saved state; the workspace default
 *   section is never shown to customers (and refused by the server).
 * Use case: /customer/settings/appearance.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function CustomerAppearancePage() {
  const area  = await requireCustomer();
  const state = await getViewerAppearanceState(area.db, { userId: area.user.id, isOwner: false });

  return (
    <>
      <PageHeading title="Appearance" description="Choose how your portal looks. Only your account is affected." />
      <div className="px-4 lg:px-6">
        <AppearanceSettings state={state} saveAction={saveCustomerAppearanceAction} />
      </div>
    </>
  );
}

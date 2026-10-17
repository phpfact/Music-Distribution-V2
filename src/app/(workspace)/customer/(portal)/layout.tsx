import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { AuthPageGuard, PermissionSync } from "@/components/shared";
import { WorkspaceThemeRoot } from "@/components/workspace/theme-root";
import { ThemeSwitch } from "@/components/workspace/theme-switch";
import { getViewerAppearanceState } from "@/lib/workspace/appearance";
import { getWorkspace } from "@/lib/workspace/context";
import { requireCustomerAccess } from "@/lib/authz/workspace";
import { customerFingerprintAction, customerLogoutAction, saveCustomerAppearanceAction } from "./actions";
import { CUSTOMER_APPEARANCE_PATH, CUSTOMER_SIDEBAR_COOKIE, customerDashboardConfig } from "./navigation";

/**
 * Description: Title every customer-area page with the tenant's name.
 * Input: None (the tenant comes from the Host header).
 * Output: A title template "<page> · <tenant name>"; never indexed.
 * Use case: Next.js metadata of the protected /customer/** pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function generateMetadata(): Promise<Metadata> {
  const workspace = await getWorkspace();
  const name      = workspace.state === "unknown" ? "Workspace" : workspace.tenant.name;
  return {
    title: { default: `Dashboard · ${name}`, template: `%s · ${name}` },
    robots: { index: false, follow: false },
  };
}

/**
 * Description: Frame every protected customer page with its own dashboard shell.
 * Input: The page content; the tenant (Host header), the session (customer area
 *   cookie), the appearance and the sidebar preference are read on the server.
 * Output: The customer's appearance, the shadcn dashboard-01 shell with the
 *   customer navigation (filtered by the user's CURRENT privileges) and theme
 *   switch, AuthPageGuard and PermissionSync. A visitor without a valid
 *   customer session is redirected to /login.
 * Use case: /customer/dashboard, /customer/<module>, /customer/settings/**.
 *   Every page and action also checks the session (and its privilege) itself.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function CustomerLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Step 1: tenant from the Host header + this area's own session.
  const area = await requireCustomerAccess();

  // Step 2: the customer's appearance (personal → workspace default → application default).
  const appearance = await getViewerAppearanceState(area.db, { userId: area.user.id, canManageWorkspace: false });

  // Step 3: the sidebar preference of this area and the privilege-filtered navigation.
  const sidebarCookie = (await cookies()).get(CUSTOMER_SIDEBAR_COOKIE.name)?.value;
  const config        = customerDashboardConfig(area.tenant.name, area.user, area.authz);

  return (
    <WorkspaceThemeRoot appearance={appearance.appearance}>
      {/* Back after logging out: a page restored from the browser's cache is re-checked. */}
      <AuthPageGuard />
      {/* Only the fingerprint (a hash) reaches the browser, never the privilege list. */}
      <PermissionSync initialFingerprint={area.authz.fingerprint} check={customerFingerprintAction} />
      <DashboardShell
        config={config}
        logoutAction={customerLogoutAction}
        sidebarOpen={sidebarCookie !== "false"}
        sidebarCookie={CUSTOMER_SIDEBAR_COOKIE}
        headerActions={
          <ThemeSwitch
            appearance={appearance.appearance}
            saveAction={saveCustomerAppearanceAction}
            settingsHref={CUSTOMER_APPEARANCE_PATH}
          />
        }
      >
        {children}
      </DashboardShell>
    </WorkspaceThemeRoot>
  );
}

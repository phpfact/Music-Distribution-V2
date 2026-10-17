import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { AuthPageGuard, PermissionSync } from "@/components/shared";
import { WorkspaceThemeRoot } from "@/components/workspace/theme-root";
import { ThemeSwitch } from "@/components/workspace/theme-switch";
import { getViewerAppearanceState } from "@/lib/workspace/appearance";
import { getWorkspace } from "@/lib/workspace/context";
import { requireTenantAccess } from "@/lib/authz/workspace";
import { saveTenantAppearanceAction, tenantFingerprintAction, tenantLogoutAction } from "./actions";
import { TENANT_APPEARANCE_PATH, TENANT_SIDEBAR_COOKIE, tenantDashboardConfig } from "./navigation";

/**
 * Description: Title every tenant-area page with the tenant's name.
 * Input: None (the tenant comes from the Host header).
 * Output: A title template "<page> · <tenant name>"; never indexed.
 * Use case: Next.js metadata of /tenant/**.
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
 * Description: Frame every tenant staff page with its own dashboard shell.
 * Input: The page content; the tenant (Host header), the session (tenant area
 *   cookie), the appearance and the sidebar preference are read on the server.
 * Output: The user's appearance, the shadcn dashboard-01 shell with the tenant
 *   navigation filtered by the user's CURRENT privileges and the theme switch,
 *   AuthPageGuard and PermissionSync (refreshes the tree when the privileges
 *   change). A visitor without a valid tenant staff session is redirected to /login.
 * Use case: /tenant/**. Not the guard on its own: every page and action checks
 *   its own privilege (layouts do not re-render on client navigation).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function TenantLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Step 1: tenant from the Host header + this area's own session.
  const area = await requireTenantAccess();

  // Step 2: the user's appearance (personal → workspace default → application default).
  const appearance = await getViewerAppearanceState(area.db, {
    userId: area.user.id,
    canManageWorkspace: area.authz.can("tenant.appearance.manage_workspace"),
  });

  // Step 3: the sidebar preference of this area (first paint matches the last choice)
  // and the navigation filtered by the user's privileges.
  const sidebarCookie = (await cookies()).get(TENANT_SIDEBAR_COOKIE.name)?.value;
  const config        = tenantDashboardConfig(area.tenant.name, area.user, area.authz);

  return (
    <WorkspaceThemeRoot appearance={appearance.appearance}>
      {/* Back after logging out: a page restored from the browser's cache is re-checked. */}
      <AuthPageGuard />
      {/* Only the fingerprint (a hash) reaches the browser, never the privilege list. */}
      <PermissionSync initialFingerprint={area.authz.fingerprint} check={tenantFingerprintAction} />
      <DashboardShell
        config={config}
        logoutAction={tenantLogoutAction}
        sidebarOpen={sidebarCookie !== "false"}
        sidebarCookie={TENANT_SIDEBAR_COOKIE}
        headerActions={
          <ThemeSwitch
            appearance={appearance.appearance}
            saveAction={saveTenantAppearanceAction}
            settingsHref={TENANT_APPEARANCE_PATH}
          />
        }
      >
        {children}
      </DashboardShell>
    </WorkspaceThemeRoot>
  );
}

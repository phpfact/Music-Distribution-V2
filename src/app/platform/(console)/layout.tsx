import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { NO_ACTIVE_ROLE_LABEL, PermissionSync } from "@/components/shared";
import { requirePlatformAccess } from "@/lib/authz/platform";
import { platformFingerprintAction } from "../actions";
import { AuthPageGuard } from "./_components/auth-page-guard";
import { ConsoleShell } from "./_components/console-shell";
import { isSidebarCollapsed, SIDEBAR_COOKIE_NAME } from "./sidebar-preference";

/**
 * Description: Frame every protected console page with the navigation shell.
 * Input: The page content; the session, the owner's CURRENT privileges and the
 *   sidebar preference cookie are read on the server.
 * Output: The ConsoleShell (sidebar, top bar, main area) with the navigation
 *   filtered by the owner's granted privilege keys and the role name in the
 *   account menu, plus AuthPageGuard and PermissionSync (refreshes the tree
 *   when the privileges change); a signed-out visitor is redirected to the
 *   login page.
 * Use case: Dashboard, tenants, settings and the planned modules
 *   (.vibe/memory/role-privilege-management.md, "Navigation").
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
export default async function PlatformConsoleLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Not the guard: every page checks its own privilege, since a layout does not
  // re-render on every navigation. Memoized, so the pages ask only once.
  const { session, access } = await requirePlatformAccess();
  const collapsed           = isSidebarCollapsed((await cookies()).get(SIDEBAR_COOKIE_NAME)?.value);
  // The account menu names the role (display only); "No active role" when it grants nothing.
  const roleLabel = access.roleState === "active" && access.roleName ? access.roleName : NO_ACTIVE_ROLE_LABEL;

  // Only the username, the role name and the granted keys (plain strings) reach the browser.
  return (
    <ConsoleShell
      username={session.owner.username}
      roleLabel={roleLabel}
      permissions={[...access.permissions]}
      initialCollapsed={collapsed}
    >
      {/* Back after sign-out: a page restored from the browser's cache is re-checked. */}
      <AuthPageGuard />
      <PermissionSync initialFingerprint={access.fingerprint} check={platformFingerprintAction} />
      {children}
    </ConsoleShell>
  );
}

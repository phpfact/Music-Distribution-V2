import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { AuthPageGuard } from "./_components/auth-page-guard";
import { ConsoleShell } from "./_components/console-shell";
import { isSidebarCollapsed, SIDEBAR_COOKIE_NAME } from "./sidebar-preference";

/**
 * Description: Frame every protected console page with the navigation shell.
 * Input: The page content; the session and the sidebar preference cookie are
 *   read on the server.
 * Output: The ConsoleShell (sidebar, top bar, main area) around the page, plus
 *   AuthPageGuard; a signed-out visitor is redirected to the login page.
 * Use case: Dashboard, tenants, settings and the planned modules.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export default async function PlatformConsoleLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Not the guard: every page checks for itself, since a layout does not
  // re-render on every navigation. Memoized, so the pages ask only once.
  const session   = await requirePlatformOwner();
  const collapsed = isSidebarCollapsed((await cookies()).get(SIDEBAR_COOKIE_NAME)?.value);

  // Only the username reaches the browser, never the session.
  return (
    <ConsoleShell username={session.owner.username} initialCollapsed={collapsed}>
      {/* Back after sign-out: a page restored from the browser's cache is re-checked. */}
      <AuthPageGuard />
      {children}
    </ConsoleShell>
  );
}

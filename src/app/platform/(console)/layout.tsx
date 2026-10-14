import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { ConsoleShell } from "./_components/console-shell";
import { isSidebarCollapsed, SIDEBAR_COOKIE_NAME } from "./sidebar-preference";

export default async function PlatformConsoleLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Not the guard: every page checks for itself, since a layout does not
  // re-render on every navigation. Memoized, so the pages ask only once.
  const session = await requirePlatformOwner();
  const collapsed = isSidebarCollapsed((await cookies()).get(SIDEBAR_COOKIE_NAME)?.value);

  // Only the username reaches the browser, never the session.
  return (
    <ConsoleShell username={session.owner.username} initialCollapsed={collapsed}>
      {children}
    </ConsoleShell>
  );
}

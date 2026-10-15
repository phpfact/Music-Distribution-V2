/**
 * Whether the desktop sidebar is collapsed, remembered in a cookie so the
 * server renders the right width on the first paint. A preference only:
 * nothing depends on it for security.
 */
export const SIDEBAR_COOKIE_NAME = "md_platform_sidebar";

/**
 * Description: Read the desktop sidebar preference from its cookie.
 * Input: The cookie value.
 * Output: True for "collapsed" (a layout preference only; nothing depends on it for security).
 * Use case: The console layout (server-rendered width on the first paint).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function isSidebarCollapsed(cookieValue: string | undefined): boolean {
  return cookieValue === "collapsed";
}

/**
 * Description: Build the cookie assignment that stores the sidebar preference.
 * Input: Whether the sidebar is collapsed.
 * Output: The document.cookie text (path /platform, one year, SameSite=Lax).
 * Use case: The console shell's collapse button.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function sidebarCookie(collapsed: boolean): string {
  const value = collapsed ? "collapsed" : "expanded";
  return `${SIDEBAR_COOKIE_NAME}=${value}; path=/platform; max-age=31536000; samesite=lax`;
}

/**
 * Whether the desktop sidebar is collapsed, remembered in a cookie so the
 * server renders the right width on the first paint. A preference only:
 * nothing depends on it for security.
 */
export const SIDEBAR_COOKIE_NAME = "md_platform_sidebar";

export function isSidebarCollapsed(cookieValue: string | undefined): boolean {
  return cookieValue === "collapsed";
}

/** The `document.cookie` assignment that stores the preference for a year. */
export function sidebarCookie(collapsed: boolean): string {
  const value = collapsed ? "collapsed" : "expanded";
  return `${SIDEBAR_COOKIE_NAME}=${value}; path=/platform; max-age=31536000; samesite=lax`;
}

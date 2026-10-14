/**
 * The platform's light/dark theme, remembered in a cookie so the server
 * renders the right class on the first paint. It is not part of the session,
 * so it outlives a sign-out. A preference only: nothing depends on it for
 * security.
 */
export const THEME_COOKIE_NAME = "md_platform_theme";

export type PlatformTheme = "light" | "dark";

/** Light unless the cookie says exactly "dark". */
export function parseTheme(value: string | undefined): PlatformTheme {
  return value === "dark" ? "dark" : "light";
}

/** The `document.cookie` assignment that stores the preference for a year. */
export function themeCookie(theme: PlatformTheme): string {
  return `${THEME_COOKIE_NAME}=${theme}; path=/platform; max-age=31536000; samesite=lax`;
}

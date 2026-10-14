import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { parseTheme, THEME_COOKIE_NAME } from "./theme-preference";
import { ThemeRoot } from "./theme-root";

export const metadata: Metadata = {
  title: { default: "Platform | Music Distribution", template: "%s | Platform | Music Distribution" },
  robots: { index: false, follow: false },
};

export default async function PlatformLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Rendered on the server from the cookie: no flash of the wrong theme.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE_NAME)?.value);
  return <ThemeRoot initialTheme={theme}>{children}</ThemeRoot>;
}

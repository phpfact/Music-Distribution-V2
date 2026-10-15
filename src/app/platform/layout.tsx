import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getPlatformSession } from "@/lib/platform-auth/dal";
import { getAppearanceState } from "@/lib/appearance/service";
import { DEFAULT_APPEARANCE, type AppearanceState } from "@/lib/appearance/preferences";
import { describeError } from "@/lib/platform-auth/session";
import { ThemeRoot } from "./theme-root";

export const metadata: Metadata = {
  title: { default: "Platform | Music Distribution", template: "%s | Platform | Music Distribution" },
  robots: { index: false, follow: false },
};

/**
 * Description: Wrap every /platform page in the resolved Appearance theme.
 * Input: The page content; the session and appearance are read on the server.
 * Output: ThemeRoot with the owner's appearance (personal, platform default or
 *   application default), keyed by the owner so an account switch remounts it.
 * Use case: Login and console pages. A signed-out visitor still gets the login
 *   page with the default appearance when the global preference cannot be read.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export default async function PlatformLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await getPlatformSession();
  let appearance: AppearanceState;
  try {
    appearance = await getAppearanceState(session?.owner.id);
  } catch (error) {
    if (session) throw error;
    // Keep the sign-in form available during a global-preference read outage.
    console.error(`[appearance] could not load login appearance: ${describeError(error)}`);
    appearance = { ownerId: null, personal: null, global: null, appearance: DEFAULT_APPEARANCE, source: "default", canManageGlobal: false };
  }
  return <ThemeRoot key={session?.owner.id ?? "signed-out"} initialState={appearance}>{children}</ThemeRoot>;
}

"use client";

import { createContext, useContext, type ReactNode } from "react";

// Undefined supports standalone components; null means ThemeRoot is mounting.
const ThemePortalContext = createContext<HTMLElement | null | undefined>(
  undefined,
);

/**
 * Provide the existing theme ancestor as the destination for UI portals.
 * Input: mounted ThemeRoot element and children. Output: context only, no wrapper.
 * Use case: dialogs, menus and sheets inherit account appearance and system mode.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15. Last modified: 2026-10-15.
 */
export function ThemePortalProvider({
  container,
  children,
}: {
  container: HTMLElement | null;
  children: ReactNode;
}) {
  return (
    <ThemePortalContext.Provider value={container}>
      {children}
    </ThemePortalContext.Provider>
  );
}

/**
 * Read the portal destination without maintaining another theme preference.
 * Input: enclosing provider. Output: theme ancestor, null while mounting, or undefined.
 * Use case: keep floating components within the single existing theme source.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15. Last modified: 2026-10-15.
 */
export function useThemePortal() {
  return useContext(ThemePortalContext);
}

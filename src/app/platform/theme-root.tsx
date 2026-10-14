"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { themeCookie } from "./theme-preference";
import type { PlatformTheme } from "./theme-preference";

type ThemeContextValue = {
  theme: PlatformTheme;
  setTheme: (theme: PlatformTheme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

type ThemeRootProps = {
  /** Read from the cookie on the server, so the first paint is already right. */
  initialTheme: PlatformTheme;
  children: ReactNode;
};

/**
 * Wraps every platform page in an element carrying the `dark` class when that
 * theme is chosen. Its background and text mirror the root body, so pages
 * look the same as before in light mode.
 */
export function ThemeRoot({ initialTheme, children }: ThemeRootProps) {
  const [theme, setThemeState] = useState(initialTheme);

  const setTheme = useCallback((next: PlatformTheme) => {
    setThemeState(next);
    document.cookie = themeCookie(next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>
      <div
        className={`${theme === "dark" ? "dark " : ""}min-h-dvh bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100`}
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

/** The current platform theme and a setter that also remembers the choice. */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside <ThemeRoot> (the platform layout).");
  return value;
}

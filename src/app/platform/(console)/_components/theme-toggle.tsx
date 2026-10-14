"use client";

import { useTheme } from "@/app/platform/theme-root";
import { Icon } from "./icons";
import { FOCUS_RING } from "./styles";

/** Switches the platform between light and dark; the choice is kept in a cookie. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label="Dark mode"
      aria-pressed={dark}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={`grid size-9 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg ${FOCUS_RING}`}
    >
      <Icon name={dark ? "sun" : "moon"} className="size-5" />
    </button>
  );
}

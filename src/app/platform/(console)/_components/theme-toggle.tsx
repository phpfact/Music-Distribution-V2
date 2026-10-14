"use client";

import Link from "next/link";
import { useTheme, useSystemDark } from "@/app/platform/theme-root";
import { Icon } from "./icons";
import { FOCUS_RING } from "./styles";

/** Changes use the explicit, persistent Settings workflow. */
export function ThemeToggle() {
  const { state } = useTheme();
  const systemDark = useSystemDark();
  const dark = state.appearance.theme === "dark" || (state.appearance.theme === "system" && systemDark);
  return (
    <Link href="/platform/settings/appearance" aria-label="Appearance settings" title="Appearance settings"
      className={`grid size-9 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg ${FOCUS_RING}`}>
      <Icon name={dark ? "moon" : "sun"} className="size-5" />
    </Link>
  );
}

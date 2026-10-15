"use client";

import Link from "next/link";
import { useTheme, useSystemDark } from "@/app/platform/theme-root";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Icon } from "./icons";

/**
 * Link to the authoritative Appearance settings with the current theme icon.
 * Input: resolved Appearance state and the operating system's dark preference.
 * Output: an accessible shadcn icon button linking to the existing save flow.
 * Use case: expose appearance controls without adding another theme selector.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function ThemeToggle() {
  const { state } = useTheme();
  const systemDark = useSystemDark();
  const dark       = state.appearance.theme === "dark" || (state.appearance.theme === "system" && systemDark);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="ghost" size="icon" className="size-9 text-muted-foreground">
          <Link href="/platform/settings/appearance" aria-label="Appearance settings"><Icon name={dark ? "moon" : "sun"} className="size-5" /></Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Appearance settings</TooltipContent>
    </Tooltip>
  );
}

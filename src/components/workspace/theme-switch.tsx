"use client";

import { Monitor, Moon, Palette, Sun } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import {
  WORKSPACE_THEME_OPTIONS,
  type WorkspaceAppearanceActionResult,
  type WorkspaceAppearanceValue,
  type WorkspaceTheme,
} from "@/lib/workspace/appearance-options";

type ThemeSwitchProps = {
  /** The appearance currently rendered for this user. */
  appearance: WorkspaceAppearanceValue;
  /** The area's appearance Server Action (it checks the session itself). */
  saveAction: (input: unknown) => Promise<WorkspaceAppearanceActionResult>;
  /** The area's Appearance settings page. */
  settingsHref: string;
};

const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

/**
 * Description: The header's quick theme control: Light / Dark / System.
 * Input: The current appearance, the area's save action and its settings link.
 * Output: A menu that saves the personal theme at once (keeping the current
 *   accent and width), refreshes the server-rendered theme without a full
 *   reload, blocks repeat clicks while saving and shows a friendly error.
 * Use case: The site header of the tenant and customer dashboards.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function ThemeSwitch({ appearance, saveAction, settingsHref }: ThemeSwitchProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Synchronous guard: a second click before React re-renders is ignored.
  const saving = useRef(false);
  const Icon   = THEME_ICONS[appearance.theme];

  /**
   * Description: Save the chosen theme as the user's personal appearance.
   * Input: The chosen theme.
   * Output: The server re-renders with the new theme, or an error is shown.
   * Use case: Radio items of this menu.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function choose(theme: WorkspaceTheme) {
    if (saving.current || theme === appearance.theme) return;
    saving.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveAction({
          operation: "apply",
          scope: "personal",
          appearance: { ...appearance, theme },
        });
        if (result.ok) router.refresh();
        else setError(result.error);
      } catch {
        setError("Your theme could not be saved. Please try again.");
      } finally {
        saving.current = false;
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Theme" aria-busy={pending || undefined}>
          {pending ? <Spinner /> : <Icon />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={appearance.theme} onValueChange={(value) => choose(value as WorkspaceTheme)}>
          {WORKSPACE_THEME_OPTIONS.map((option) => {
            const OptionIcon = THEME_ICONS[option.value];
            return (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                disabled={pending}
                onSelect={(event) => event.preventDefault()}
              >
                <OptionIcon />
                {option.label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        {error ? (
          <p role="alert" className="px-2 py-1.5 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={settingsHref}>
            <Palette />
            Appearance settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

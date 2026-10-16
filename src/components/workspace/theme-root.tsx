"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { ThemePortalProvider } from "@/components/theme-portal";
import {
  WORKSPACE_ACCENT_OPTIONS,
  WORKSPACE_WIDTH_OPTIONS,
  type WorkspaceAppearanceValue,
} from "@/lib/workspace/appearance-options";
import { cn } from "@/lib/utils";

type WorkspaceThemeRootProps = {
  /** The server-resolved appearance (personal → workspace → default). */
  appearance: WorkspaceAppearanceValue;
  className?: string;
  children: ReactNode;
};

/**
 * Description: Apply a workspace appearance to everything inside it.
 * Input: The appearance resolved on the server, optional classes and the page.
 * Output: A themed root element: the theme class ("light", "dark" or "system",
 *   which globals.css resolves with a media query before hydration, so there is
 *   no theme flash), the accent colours and the content width as CSS
 *   variables. Dialogs, menus and sheets portal into this element, so overlays
 *   use the same theme.
 * Use case: Every page served on a tenant's domain (welcome, login, sign-up,
 *   tenant and customer dashboards). Separate from the Platform Owner's
 *   ThemeRoot by design (owner decision 2026-10-15).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function WorkspaceThemeRoot({ appearance, className, children }: WorkspaceThemeRootProps) {
  // The element itself is the portal container (set once it has mounted).
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);

  // Unknown values cannot reach here (validated on the server); the first
  // option is the safe fallback anyway.
  const accent = WORKSPACE_ACCENT_OPTIONS.find((option) => option.value === appearance.accent) ?? WORKSPACE_ACCENT_OPTIONS[0];
  const width  = WORKSPACE_WIDTH_OPTIONS.find((option) => option.value === appearance.width) ?? WORKSPACE_WIDTH_OPTIONS[0];
  const style = {
    "--accent-light": accent?.light,
    "--accent-dark": accent?.dark,
    "--workspace-content-max-width": width?.maxWidth,
  } as CSSProperties;

  return (
    <div
      ref={setPortalContainer}
      data-workspace-theme={appearance.theme}
      data-accent={appearance.accent}
      data-content-width={appearance.width}
      style={style}
      className={cn(appearance.theme, "workspace-theme min-h-svh bg-background text-foreground", className)}
    >
      <ThemePortalProvider container={portalContainer}>{children}</ThemePortalProvider>
    </div>
  );
}

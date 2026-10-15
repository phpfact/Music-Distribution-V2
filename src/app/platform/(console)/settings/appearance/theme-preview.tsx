import type { CSSProperties } from "react";
import { ACCENT_OPTIONS, type Appearance } from "@/lib/appearance/preferences";
import { cn } from "@/lib/utils";

type ThemePreviewProps = {
  theme: Appearance["theme"];
  accent: Appearance["accent"];
  width?: Appearance["width"];
  /** The big preview under the choices (taller, more padding). */
  large?: boolean;
};

// How much of the miniature's content area each width option uses.
const PREVIEW_CONTENT_WIDTHS: Readonly<Record<Appearance["width"], string>> = {
  full:    "100%",
  default: "90%",
  focused: "72%",
};

/**
 * Description: Illustrate the selected theme, accent, and content width without applying them.
 * Input: The draft theme, accent and width, and whether it is the large preview.
 * Output: A decorative miniature console. "System" shows the light half and the
 *   dark half side by side.
 * Use case: The theme and width choices and the large preview of Appearance settings.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function ThemePreview({ theme, accent, width = "default", large = false }: ThemePreviewProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative block overflow-hidden rounded-xl border border-border",
        large ? "h-56 sm:h-64" : "h-32 sm:h-36",
      )}
    >
      <PreviewCanvas dark={theme === "dark"} accent={accent} width={width} large={large} />
      {/* System: the right half shows the dark variant. */}
      {theme === "system" ? (
        <span className="absolute inset-0 block [clip-path:inset(0_0_0_50%)]">
          <PreviewCanvas dark accent={accent} width={width} large={large} />
        </span>
      ) : null}
    </span>
  );
}

type PreviewCanvasProps = {
  dark: boolean;
  accent: Appearance["accent"];
  width: Appearance["width"];
  large: boolean;
};

/**
 * Description: Render one theme variant of the miniature console from the real theme tokens.
 * Input: Light or dark, the accent, the width option and the preview size.
 * Output: A miniature in its own `platform-theme` scope (light or dark) with the
 *   accent's colours, so it uses exactly the tokens of globals.css and never
 *   hard-coded colours, independently of the theme the page itself uses.
 * Use case: ThemePreview (both halves of a System preview share it).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function PreviewCanvas({ dark, accent, width, large }: PreviewCanvasProps) {
  // The accent's light and dark colours drive --brand inside this scope.
  const option     = ACCENT_OPTIONS.find((item) => item.value === accent) ?? ACCENT_OPTIONS[0];
  const scopeStyle = { "--accent-light": option.light, "--accent-dark": option.dark } as CSSProperties;

  return (
    <span
      style={scopeStyle}
      className={cn("platform-theme flex h-full w-full bg-canvas text-left text-fg", dark ? "dark" : "light")}
    >
      {/* Sidebar: window dots, the brand tile and four navigation lines. */}
      <span className={cn("block shrink-0 border-r border-line bg-surface", large ? "w-[22%] p-4" : "w-[24%] p-2.5")}>
        <span className="mb-5 flex gap-1">
          <span className="size-1 rounded-full bg-fg-subtle/60" />
          <span className="size-1 rounded-full bg-fg-subtle/40" />
          <span className="size-1 rounded-full bg-fg-subtle/20" />
        </span>
        <span className={cn("block rounded-lg bg-primary", large ? "mb-4 size-7" : "mb-3 size-4")} />
        {[0, 1, 2, 3].map((line) => (
          <span
            key={line}
            className={cn(
              "block rounded-full",
              large ? "mb-3 h-2" : "mb-2 h-1",
              // The first line is the active item, drawn in the accent.
              line === 0 ? "bg-primary/80" : "bg-fg-subtle/40",
            )}
            style={{ width: line === 0 ? "90%" : `${70 - line * 10}%` }}
          />
        ))}
      </span>

      {/* Content: title, three stat cards and a list, at the chosen width. */}
      <span className={cn("block min-w-0 flex-1", large ? "p-5 sm:p-6" : "p-3")}>
        <span className="mx-auto block" style={{ width: PREVIEW_CONTENT_WIDTHS[width] }}>
          <span className="mb-3 flex items-center justify-between gap-2">
            <span className={cn("font-semibold", large ? "text-xs" : "text-[8px]")}>Your dashboard</span>
            <span className="h-2 w-6 rounded bg-primary" />
          </span>
          <span className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((card) => (
              <span
                key={card}
                className={cn("block rounded-md border border-line bg-surface", large ? "h-14 p-3" : "h-7 p-1.5")}
              >
                <span className="mb-2 block h-1 w-3/4 rounded bg-fg-subtle/40" />
                <span className={cn("block w-1/3 rounded bg-fg/70", large ? "h-3" : "h-1.5")} />
              </span>
            ))}
          </span>
          <span className={cn("block rounded-md border border-line bg-surface", large ? "mt-4 p-4" : "mt-2 p-2")}>
            {[0, 1, 2].map((row) => (
              <span
                key={row}
                className={cn(
                  "flex items-center gap-2 border-b border-line last:border-0",
                  large ? "py-2.5" : "py-1.5",
                )}
              >
                <span className={cn("shrink-0 rounded-full bg-primary/30", large ? "size-4" : "size-2")} />
                <span className="h-1 w-2/5 rounded bg-fg-subtle/40" />
                <span className="ml-auto h-1 w-1/5 rounded bg-primary/60" />
              </span>
            ))}
          </span>
        </span>
      </span>
    </span>
  );
}

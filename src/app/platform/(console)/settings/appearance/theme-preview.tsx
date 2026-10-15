import { ACCENT_OPTIONS, type Appearance } from "@/lib/appearance/preferences";

/**
 * Illustrate the selected theme, accent, and content width without applying them.
 * Input: the draft appearance fields and an optional large-preview flag.
 * Output: a decorative phrasing-content preview with proportionate width gutters.
 * Use case: compare width choices and preview the complete unsaved appearance.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function ThemePreview({ theme, accent, width = "default", large = false }: { theme: Appearance["theme"]; accent: Appearance["accent"]; width?: Appearance["width"]; large?: boolean }) {
  const color = ACCENT_OPTIONS.find((option) => option.value === accent) ?? ACCENT_OPTIONS[0];
  return (
    <span aria-hidden="true" className={`relative block overflow-hidden rounded-xl border border-border ${large ? "h-56 sm:h-64" : "h-32 sm:h-36"}`}>
      <PreviewCanvas dark={theme === "dark"} color={theme === "dark" ? color.dark : color.light} width={width} large={large} />
      {theme === "system" ? (
        <span className="absolute inset-0 block [clip-path:inset(0_0_0_50%)]">
          <PreviewCanvas dark color={color.dark} width={width} large={large} />
        </span>
      ) : null}
    </span>
  );
}

/**
 * Render one theme half with its content width scaled to the illustrative canvas.
 * Input: theme darkness, accent color, width mode, and preview size.
 * Output: a visual miniature with narrower content for Default and Focused modes.
 * Use case: share the exact layout between standalone and split System previews.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function PreviewCanvas({ dark, color, width, large }: { dark: boolean; color: string; width: Appearance["width"]; large: boolean }) {
  // Fixed draft palettes are illustration data, independent of the saved theme.
  const palette = dark
    ? { canvas: "#13171d", surface: "#1b2028", line: "#303740", text: "#e7e9ec", muted: "#5d6570" }
    : { canvas: "#f5f6f8", surface: "#fff", line: "#e8eaee", text: "#303640", muted: "#c3c9d2" };
  return (
    <span className="flex h-full w-full text-left" style={{ background: palette.canvas, color: palette.text }}>
      <span className={`${large ? "w-[22%] p-4" : "w-[24%] p-2.5"} block shrink-0 border-r`} style={{ background: palette.surface, borderColor: palette.line }}>
        <span className="mb-5 flex gap-1"><span className="size-1 rounded-full bg-rose-400" /><span className="size-1 rounded-full bg-amber-400" /><span className="size-1 rounded-full bg-emerald-400" /></span>
        <span className={`${large ? "mb-4 size-7" : "mb-3 size-4"} block rounded-lg`} style={{ background: color }} />
        {[0, 1, 2, 3].map((i) => <span key={i} className={`${large ? "mb-3 h-2" : "mb-2 h-1"} block rounded-full`} style={{ background: i === 0 ? color : palette.muted, width: i === 0 ? "90%" : `${70 - i * 10}%`, opacity: i === 0 ? 0.8 : 0.5 }} />)}
      </span>
      <span className={`${large ? "p-5 sm:p-6" : "p-3"} block min-w-0 flex-1`}>
        <span className="mx-auto block" style={{ width: width === "full" ? "100%" : width === "focused" ? "72%" : "90%" }}>
        <span className="mb-3 flex items-center justify-between gap-2"><span className={`${large ? "text-xs" : "text-[8px]"} font-semibold`}>Your dashboard</span><span className="h-2 w-6 rounded" style={{ background: color }} /></span>
        <span className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => <span key={i} className={`${large ? "h-14 p-3" : "h-7 p-1.5"} block rounded-md border`} style={{ background: palette.surface, borderColor: palette.line }}><span className="mb-2 block h-1 w-3/4 rounded" style={{ background: palette.muted }} /><span className={`${large ? "h-3" : "h-1.5"} block w-1/3 rounded`} style={{ background: palette.text, opacity: 0.7 }} /></span>)}
        </span>
        <span className={`${large ? "mt-4 p-4" : "mt-2 p-2"} block rounded-md border`} style={{ background: palette.surface, borderColor: palette.line }}>
          {[0, 1, 2].map((i) => <span key={i} className={`${large ? "py-2.5" : "py-1.5"} flex items-center gap-2 border-b last:border-0`} style={{ borderColor: palette.line }}><span className={`${large ? "size-4" : "size-2"} shrink-0 rounded-full`} style={{ background: color, opacity: 0.3 }} /><span className="h-1 w-2/5 rounded" style={{ background: palette.muted }} /><span className="ml-auto h-1 w-1/5 rounded" style={{ background: color, opacity: 0.6 }} /></span>)}
        </span>
        </span>
      </span>
    </span>
  );
}

import { ACCENT_OPTIONS, type Appearance } from "@/lib/appearance/preferences";

/**
 * Illustrate the selected theme, accent, and content width without applying them.
 * Input: the draft appearance fields and an optional large-preview flag.
 * Output: a decorative console preview with proportionate content-width gutters.
 * Use case: compare width choices and preview the complete unsaved appearance.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-14
 */
export function ThemePreview({ theme, accent, width = "default", large = false }: { theme: Appearance["theme"]; accent: Appearance["accent"]; width?: Appearance["width"]; large?: boolean }) {
  const color = ACCENT_OPTIONS.find((option) => option.value === accent) ?? ACCENT_OPTIONS[0];
  return (
    <div aria-hidden="true" className={`relative overflow-hidden rounded-xl border border-black/10 ${large ? "h-56 sm:h-64" : "h-32 sm:h-36"}`}>
      <PreviewCanvas dark={theme === "dark"} color={theme === "dark" ? color.dark : color.light} width={width} large={large} />
      {theme === "system" ? (
        <div className="absolute inset-0 [clip-path:inset(0_0_0_50%)]">
          <PreviewCanvas dark color={color.dark} width={width} large={large} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Render one theme half with its content width scaled to the illustrative canvas.
 * Input: theme darkness, accent color, width mode, and preview size.
 * Output: a visual miniature with narrower content for Default and Focused modes.
 * Use case: share the exact layout between standalone and split System previews.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-14
 */
function PreviewCanvas({ dark, color, width, large }: { dark: boolean; color: string; width: Appearance["width"]; large: boolean }) {
  const palette = dark
    ? { canvas: "#13171d", surface: "#1b2028", line: "#303740", text: "#e7e9ec", muted: "#5d6570" }
    : { canvas: "#f5f6f8", surface: "#fff", line: "#e8eaee", text: "#303640", muted: "#c3c9d2" };
  return (
    <div className="flex h-full w-full text-left" style={{ background: palette.canvas, color: palette.text }}>
      <div className={`${large ? "w-[22%] p-4" : "w-[24%] p-2.5"} shrink-0 border-r`} style={{ background: palette.surface, borderColor: palette.line }}>
        <div className="mb-5 flex gap-1"><span className="size-1 rounded-full bg-rose-400" /><span className="size-1 rounded-full bg-amber-400" /><span className="size-1 rounded-full bg-emerald-400" /></div>
        <div className={`${large ? "mb-4 size-7" : "mb-3 size-4"} rounded-lg`} style={{ background: color }} />
        {[0, 1, 2, 3].map((i) => <div key={i} className={`${large ? "mb-3 h-2" : "mb-2 h-1"} rounded-full`} style={{ background: i === 0 ? color : palette.muted, width: i === 0 ? "90%" : `${70 - i * 10}%`, opacity: i === 0 ? 0.8 : 0.5 }} />)}
      </div>
      <div className={`${large ? "p-5 sm:p-6" : "p-3"} min-w-0 flex-1`}>
        <div className="mx-auto" style={{ width: width === "full" ? "100%" : width === "focused" ? "72%" : "90%" }}>
        <div className="mb-3 flex items-center justify-between gap-2"><span className={`${large ? "text-xs" : "text-[8px]"} font-semibold`}>Your dashboard</span><span className="h-2 w-6 rounded" style={{ background: color }} /></div>
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => <div key={i} className={`${large ? "h-14 p-3" : "h-7 p-1.5"} rounded-md border`} style={{ background: palette.surface, borderColor: palette.line }}><div className="mb-2 h-1 w-3/4 rounded" style={{ background: palette.muted }} /><div className={`${large ? "h-3" : "h-1.5"} w-1/3 rounded`} style={{ background: palette.text, opacity: 0.7 }} /></div>)}
        </div>
        <div className={`${large ? "mt-4 p-4" : "mt-2 p-2"} rounded-md border`} style={{ background: palette.surface, borderColor: palette.line }}>
          {[0, 1, 2].map((i) => <div key={i} className={`${large ? "py-2.5" : "py-1.5"} flex items-center gap-2 border-b last:border-0`} style={{ borderColor: palette.line }}><span className={`${large ? "size-4" : "size-2"} shrink-0 rounded-full`} style={{ background: color, opacity: 0.3 }} /><span className="h-1 w-2/5 rounded" style={{ background: palette.muted }} /><span className="ml-auto h-1 w-1/5 rounded" style={{ background: color, opacity: 0.6 }} /></div>)}
        </div>
        </div>
      </div>
    </div>
  );
}

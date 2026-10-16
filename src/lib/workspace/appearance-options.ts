/**
 * Workspace (tenant portal) appearance: the options and the pure rules
 * (.vibe/memory/workspace-appearance.md).
 *
 * Built separately from the Platform Owner appearance (owner decision
 * 2026-10-15): the tenant portal never imports the platform's appearance code.
 * Client-safe: no `server-only`, no environment access.
 */

export type WorkspaceTheme  = "light" | "dark" | "system";
export type WorkspaceAccent = "neutral" | "emerald" | "indigo" | "violet" | "blue" | "rose" | "amber";
export type WorkspaceWidth  = "default" | "full" | "focused";

/** One complete appearance: what is stored and what is rendered. */
export type WorkspaceAppearanceValue = {
  theme: WorkspaceTheme;
  accent: WorkspaceAccent;
  width: WorkspaceWidth;
};

/** Where the rendered appearance came from. */
export type WorkspaceAppearanceSource = "personal" | "workspace" | "default";

/** What a signed-in page knows about its viewer's appearance. */
export type WorkspaceAppearanceState = {
  /** The viewer's own override, or null. */
  personal: WorkspaceAppearanceValue | null;
  /** The tenant administrator's workspace default, or null. */
  workspace: WorkspaceAppearanceValue | null;
  /** The appearance actually rendered (personal → workspace → default). */
  appearance: WorkspaceAppearanceValue;
  source: WorkspaceAppearanceSource;
  /** True only for the tenant owner: may change the workspace default. */
  canManageWorkspace: boolean;
};

/**
 * The application default (CLAUDE.md "Default Theme"): shadcn's neutral
 * black-and-white look in light mode with the standard width.
 */
export const WORKSPACE_DEFAULT_APPEARANCE: WorkspaceAppearanceValue = {
  theme: "light",
  accent: "neutral",
  width: "default",
};

export type ThemeOption = { value: WorkspaceTheme; label: string; description: string };

export const WORKSPACE_THEME_OPTIONS: readonly ThemeOption[] = [
  { value: "light",  label: "Light",  description: "A bright, clear workspace." },
  { value: "dark",   label: "Dark",   description: "A calmer view in low light." },
  { value: "system", label: "System", description: "Follow your device’s light or dark mode." },
];

/** `light` works on white surfaces, `dark` on dark surfaces. */
export type AccentOption = { value: WorkspaceAccent; label: string; light: string; dark: string };

export const WORKSPACE_ACCENT_OPTIONS: readonly AccentOption[] = [
  { value: "neutral", label: "Neutral", light: "#171717", dark: "#e5e5e5" },
  { value: "emerald", label: "Emerald", light: "#047857", dark: "#34d399" },
  { value: "indigo",  label: "Indigo",  light: "#4f46e5", dark: "#a5b4fc" },
  { value: "violet",  label: "Violet",  light: "#7c3aed", dark: "#c4b5fd" },
  { value: "blue",    label: "Blue",    light: "#2563eb", dark: "#93c5fd" },
  { value: "rose",    label: "Rose",    light: "#be123c", dark: "#fda4af" },
  { value: "amber",   label: "Amber",   light: "#92400e", dark: "#fcd34d" },
];

export type WidthOption = { value: WorkspaceWidth; label: string; description: string; maxWidth: string };

export const WORKSPACE_WIDTH_OPTIONS: readonly WidthOption[] = [
  { value: "default", label: "Default width", description: "The standard dashboard layout.", maxWidth: "96rem" },
  { value: "full",    label: "Full width",    description: "Use all available space.",        maxWidth: "none" },
  { value: "focused", label: "Focused width", description: "Keep content in a narrower column.", maxWidth: "72rem" },
];

/**
 * Description: Tell whether a value is a plain object.
 * Input: Any value.
 * Output: True for a non-null, non-array object.
 * Use case: parseWorkspaceAppearance, before reading keys.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Description: Validate a complete appearance against the exact option lists.
 * Input: Untrusted data (a stored row or a submitted value).
 * Output: The appearance, or null when any of theme/accent/width is missing or unknown.
 * Use case: Reading stored preferences (bad rows fall back) and validating saves.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function parseWorkspaceAppearance(value: unknown): WorkspaceAppearanceValue | null {
  if (!isRecord(value)) return null;

  // Each part must be one of the listed options; nothing is coerced.
  const theme  = WORKSPACE_THEME_OPTIONS.find((option) => option.value === value.theme);
  const accent = WORKSPACE_ACCENT_OPTIONS.find((option) => option.value === value.accent);
  const width  = WORKSPACE_WIDTH_OPTIONS.find((option) => option.value === value.width);
  if (!theme || !accent || !width) return null;

  return { theme: theme.value, accent: accent.value, width: width.value };
}

/**
 * Description: Resolve which appearance is rendered.
 * Input: The viewer's stored override and the stored workspace default (untrusted).
 * Output: The first valid of personal → workspace → application default, and its source.
 * Use case: Every tenant-host page (public pages pass no personal value).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function resolveWorkspaceAppearance(
  personal: unknown,
  workspace: unknown,
): { appearance: WorkspaceAppearanceValue; source: WorkspaceAppearanceSource } {
  const personalValue = parseWorkspaceAppearance(personal);
  if (personalValue) return { appearance: personalValue, source: "personal" };

  const workspaceValue = parseWorkspaceAppearance(workspace);
  if (workspaceValue) return { appearance: workspaceValue, source: "workspace" };

  // A copy, so no caller can change the constant.
  return { appearance: { ...WORKSPACE_DEFAULT_APPEARANCE }, source: "default" };
}

/**
 * Description: Compare two appearances field by field.
 * Input: Two complete appearances.
 * Output: True when theme, accent and width all match.
 * Use case: Detecting unsaved changes on the Appearance page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function sameWorkspaceAppearance(a: WorkspaceAppearanceValue, b: WorkspaceAppearanceValue): boolean {
  return a.theme === b.theme && a.accent === b.accent && a.width === b.width;
}

/**
 * Description: Describe an appearance in one line.
 * Input: A complete appearance.
 * Output: e.g. "Light · Neutral · Default width".
 * Use case: "Currently saved" summaries and confirmation dialogs.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function describeWorkspaceAppearance(value: WorkspaceAppearanceValue): string {
  const theme  = WORKSPACE_THEME_OPTIONS.find((option) => option.value === value.theme)?.label ?? "Light";
  const accent = WORKSPACE_ACCENT_OPTIONS.find((option) => option.value === value.accent)?.label ?? "Neutral";
  const width  = WORKSPACE_WIDTH_OPTIONS.find((option) => option.value === value.width)?.label ?? "Default width";
  return `${theme} · ${accent} · ${width}`;
}

/** What an appearance Server Action answers (tenant and customer areas). */
export type WorkspaceAppearanceActionResult =
  | { ok: true; state: WorkspaceAppearanceState }
  | { ok: false; error: string };

/** What a save asks for: apply or reset, for me or for the whole workspace. */
export type WorkspaceAppearanceUpdate =
  | { operation: "apply"; scope: "personal" | "workspace"; appearance: WorkspaceAppearanceValue }
  | { operation: "reset"; scope: "personal" | "workspace" };

/**
 * Description: Validate an untrusted appearance save request.
 * Input: The Server Action argument.
 * Output: A valid update, or null (unknown operation/scope, incomplete appearance).
 * Use case: The appearance Server Actions of the tenant and customer areas.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function parseWorkspaceAppearanceUpdate(value: unknown): WorkspaceAppearanceUpdate | null {
  if (!isRecord(value)) return null;
  if (value.scope !== "personal" && value.scope !== "workspace") return null;

  if (value.operation === "reset") return { operation: "reset", scope: value.scope };
  if (value.operation !== "apply") return null;

  const appearance = parseWorkspaceAppearance(value.appearance);
  return appearance ? { operation: "apply", scope: value.scope, appearance } : null;
}

import { UUID_PATTERN } from "@/lib/uuid";

/** Shared, serializable appearance values. No browser storage is authoritative. */
export type Appearance = {
  theme: "light" | "dark" | "system";
  accent: "neutral" | "emerald" | "indigo" | "violet" | "blue" | "rose" | "amber";
  /** Controls the available console content area, independently of theme. */
  width: "default" | "full" | "focused";
};

export type AppearanceSource = "personal" | "global" | "default";

export type AppearanceState = {
  ownerId: string | null;
  personal: Appearance | null;
  global: Appearance | null;
  appearance: Appearance;
  source: AppearanceSource;
  canManageGlobal: boolean;
};

export type AppearanceUpdateInput = (
  | { operation: "apply"; scope: "personal" | "global"; appearance: Appearance }
  | { operation: "reset"; scope: "personal" | "global"; appearance?: never }
) & {
  /** Detect a stale tab after account switching; never used as the write target. */
  expectedOwnerId?: string;
};

export type AppearanceActionResult =
  | { ok: true; state: AppearanceState }
  | { ok: false; error: string };

/**
 * The application default (CLAUDE.md "Default Theme"): shadcn's official
 * black-and-white neutral look, in light mode, with the standard width.
 * Used when an owner has no personal override and no platform default exists,
 * and by "Default Theme to Me/All".
 */
export const DEFAULT_APPEARANCE: Appearance = { theme: "light", accent: "neutral", width: "default" };

/** Light colors work with white controls; dark colors work on dark surfaces. */
type AccentOption = {
  value: Appearance["accent"];
  label: string;
  light: string;
  dark: string;
};

/**
 * Every selectable accent. Neutral uses shadcn's neutral primary (near-black
 * in light mode, near-white in dark mode); the others add a brand colour.
 */
export const ACCENT_OPTIONS: readonly [AccentOption, ...AccentOption[]] = [
  { value: "neutral", label: "Neutral", light: "#171717", dark: "#e5e5e5" },
  { value: "emerald", label: "Emerald", light: "#047857", dark: "#34d399" },
  { value: "indigo",  label: "Indigo",  light: "#4f46e5", dark: "#a5b4fc" },
  { value: "violet",  label: "Violet",  light: "#7c3aed", dark: "#c4b5fd" },
  { value: "blue",    label: "Blue",    light: "#2563eb", dark: "#93c5fd" },
  { value: "rose",    label: "Rose",    light: "#be123c", dark: "#fda4af" },
  { value: "amber",   label: "Amber",   light: "#92400e", dark: "#fcd34d" },
];

/** Width presets are shared by controls, previews, and the responsive console. */
export type WidthOption = {
  value: Appearance["width"];
  label: "Default Width" | "Full Width" | "Focused Width";
  description: string;
  maxWidth: "96rem" | "none" | "72rem";
};
export const WIDTH_OPTIONS: readonly [WidthOption, ...WidthOption[]] = [
  { value: "default", label: "Default Width", description: "Keep the standard workspace layout.", maxWidth: "96rem" },
  { value: "full", label: "Full Width", description: "Use all available workspace space.", maxWidth: "none" },
  { value: "focused", label: "Focused Width", description: "Keep content centered in a narrower workspace.", maxWidth: "72rem" },
];

// The exact keys a stored or submitted appearance has.
const APPEARANCE_KEYS = ["theme", "accent", "width"] as const;

/**
 * Description: Tell whether a value is a plain object (not null, not an array).
 * Input: Any value.
 * Output: True for a plain object record.
 * Use case: parseAppearance and parseAppearanceUpdate, before reading keys.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Description: Validate the exact supported theme, accent, and width combination.
 * Input: Untrusted serialized appearance data, including direct action requests.
 * Output: A complete supported appearance, or null without coercing invalid data.
 * Use case: Shared client validation, persisted preference reads, and server writes.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function parseAppearance(value: unknown): Appearance | null {
  // Step 1: exactly the three known keys, nothing more and nothing less.
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  const hasExactKeys =
    keys.length === APPEARANCE_KEYS.length && APPEARANCE_KEYS.every((key) => Object.hasOwn(value, key));
  if (!hasExactKeys) return null;

  // Step 2: each value must be one of the supported options.
  const theme  = value.theme;
  const accent = value.accent;
  const width  = value.width;
  if (theme !== "light" && theme !== "dark" && theme !== "system") return null;
  if (!ACCENT_OPTIONS.some((option) => option.value === accent)) return null;
  // Width must come from the shared presets; arbitrary CSS sizes are never saved.
  if (!WIDTH_OPTIONS.some((option) => option.value === width)) return null;

  return { theme, accent: accent as Appearance["accent"], width: width as Appearance["width"] };
}

/**
 * Description: Resolve personal, global, and application appearance precedence.
 * Input: Optional saved personal and global preference values.
 * Output: A fresh supported appearance and the source that supplied it.
 * Use case: Consistent server-rendered appearance and safe personal resets.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function resolveAppearance(
  personal: unknown,
  global: unknown,
): { appearance: Appearance; source: AppearanceSource } {
  // 1. The owner's own valid override.
  const personalAppearance = parseAppearance(personal);
  if (personalAppearance) return { appearance: personalAppearance, source: "personal" };

  // 2. The platform default.
  const globalAppearance = parseAppearance(global);
  if (globalAppearance) return { appearance: globalAppearance, source: "global" };

  // 3. The application default (a copy, so callers can never change the constant).
  return { appearance: { ...DEFAULT_APPEARANCE }, source: "default" };
}

/**
 * Description: Validate an appearance operation and its optional account guard.
 * Input: Untrusted apply/reset request; applies require all appearance fields.
 * Output: A supported action input, or null for unsupported keys and values.
 * Use case: Reject manipulated requests before any preference transaction starts.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function parseAppearanceUpdate(value: unknown): AppearanceUpdateInput | null {
  // Step 1: an object with a known operation scope.
  if (!isRecord(value)) return null;
  if (!Object.hasOwn(value, "operation") || !Object.hasOwn(value, "scope")) return null;
  if (value.scope !== "personal" && value.scope !== "global") return null;

  // Step 2: the optional account-switch guard must be a well-formed owner id.
  const hasGuard = Object.hasOwn(value, "expectedOwnerId");
  const expected = hasGuard ? value.expectedOwnerId : undefined;
  if (hasGuard && (typeof expected !== "string" || !UUID_PATTERN.test(expected))) return null;
  const guard = typeof expected === "string" ? { expectedOwnerId: expected } : {};

  // Step 3: a reset carries nothing else; an apply carries a complete appearance.
  const keys = Object.keys(value).filter((key) => key !== "expectedOwnerId");
  if (value.operation === "reset" && keys.length === 2) {
    return { operation: "reset", scope: value.scope, ...guard };
  }
  if (value.operation !== "apply" || keys.length !== 3 || !Object.hasOwn(value, "appearance")) return null;
  const appearance = parseAppearance(value.appearance);
  return appearance ? { operation: "apply", scope: value.scope, appearance, ...guard } : null;
}

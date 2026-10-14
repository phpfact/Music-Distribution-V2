/** Shared, serializable appearance values. No browser storage is authoritative. */
export type Appearance = {
  theme: "light" | "dark" | "system";
  accent: "emerald" | "indigo" | "violet" | "blue" | "rose" | "amber";
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

export const DEFAULT_APPEARANCE: Appearance = { theme: "light", accent: "emerald", width: "default" };

/** Light colors work with white controls; dark colors work on dark surfaces. */
type AccentOption = {
  value: Appearance["accent"];
  label: string;
  light: string;
  dark: string;
};
export const ACCENT_OPTIONS: readonly [AccentOption, ...AccentOption[]] = [
  { value: "emerald", label: "Emerald", light: "#047857", dark: "#34d399" },
  { value: "indigo", label: "Indigo", light: "#4f46e5", dark: "#a5b4fc" },
  { value: "violet", label: "Violet", light: "#7c3aed", dark: "#c4b5fd" },
  { value: "blue", label: "Blue", light: "#2563eb", dark: "#93c5fd" },
  { value: "rose", label: "Rose", light: "#be123c", dark: "#fda4af" },
  { value: "amber", label: "Amber", light: "#92400e", dark: "#fcd34d" },
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

/**
 * Description: Validate the exact supported theme, accent, and width combination.
 * Input: Untrusted serialized appearance data, including direct action requests.
 * Output: A complete supported appearance, or null without coercing invalid data.
 * Use case: Shared client validation, persisted preference reads, and server writes.
 * Author: Mr. Sachin Sharma
 * Created date: 2026-10-14
 * Last modified date: 2026-10-14
 */
export function parseAppearance(value: unknown): Appearance | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3 || !Object.hasOwn(record, "theme") || !Object.hasOwn(record, "accent") || !Object.hasOwn(record, "width")) {
    return null;
  }
  const theme = record.theme;
  const accent = record.accent;
  const width = record.width;
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
 * Created date: 2026-10-14
 * Last modified date: 2026-10-14
 */
export function resolveAppearance(
  personal: unknown,
  global: unknown,
): { appearance: Appearance; source: AppearanceSource } {
  const personalAppearance = parseAppearance(personal);
  if (personalAppearance) return { appearance: personalAppearance, source: "personal" };
  const globalAppearance = parseAppearance(global);
  if (globalAppearance) return { appearance: globalAppearance, source: "global" };
  return { appearance: { ...DEFAULT_APPEARANCE }, source: "default" };
}

/**
 * Description: Validate an appearance operation and its optional account guard.
 * Input: Untrusted apply/reset request; applies require all appearance fields.
 * Output: A supported action input, or null for unsupported keys and values.
 * Use case: Reject manipulated requests before any preference transaction starts.
 * Author: Mr. Sachin Sharma
 * Created date: 2026-10-14
 * Last modified date: 2026-10-14
 */
export function parseAppearanceUpdate(value: unknown): AppearanceUpdateInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Object.hasOwn(record, "operation") || !Object.hasOwn(record, "scope")) return null;
  if (record.scope !== "personal" && record.scope !== "global") return null;
  const expected = Object.hasOwn(record, "expectedOwnerId")
    ? record.expectedOwnerId
    : undefined;
  if (Object.hasOwn(record, "expectedOwnerId") && (
    typeof expected !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expected)
  )) return null;
  const guard = typeof expected === "string" ? { expectedOwnerId: expected } : {};
  const keys = Object.keys(record).filter((key) => key !== "expectedOwnerId");
  if (record.operation === "reset" && keys.length === 2) {
    return { operation: "reset", scope: record.scope, ...guard };
  }
  if (record.operation !== "apply" || keys.length !== 3 || !Object.hasOwn(record, "appearance")) return null;
  const appearance = parseAppearance(record.appearance);
  return appearance ? { operation: "apply", scope: record.scope, appearance, ...guard } : null;
}

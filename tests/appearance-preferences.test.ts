import { describe, expect, it } from "vitest";
import {
  ACCENT_OPTIONS,
  DEFAULT_APPEARANCE,
  WIDTH_OPTIONS,
  parseAppearance,
  parseAppearanceUpdate,
  resolveAppearance,
} from "@/lib/appearance/preferences";

const personal = { theme: "dark", accent: "violet", width: "focused" } as const;
const global = { theme: "system", accent: "blue", width: "full" } as const;

describe("supported appearance values", () => {
  it("supports only the complete, exact theme/accent/width combinations", () => {
    for (const theme of ["light", "dark", "system"] as const) {
      for (const { value: accent } of ACCENT_OPTIONS) {
        for (const { value: width } of WIDTH_OPTIONS) {
          expect(parseAppearance({ theme, accent, width })).toStrictEqual({ theme, accent, width });
        }
      }
    }
  });

  it.each([
    null, undefined, [], "dark", {}, { theme: "dark" },
    { theme: "DARK", accent: "emerald" }, { theme: " dark", accent: "emerald" },
    { theme: "light", accent: "#047857" }, { theme: "light", accent: "Emerald" },
    { theme: "dark", accent: "violet", width: "focused", ownerId: "someone-else" },
    { theme: "dark", accent: "violet" },
    { theme: "dark", accent: "violet", width: "wide" },
    { theme: "dark", accent: "violet", width: "FULL" },
    { theme: "dark", accent: "violet", width: " full" },
    { theme: "dark", accent: "violet", width: "100vw" },
    { theme: "dark", accent: "violet", width: null },
  ])("rejects unsupported or malformed appearance %j", (value) => {
    expect(parseAppearance(value)).toBeNull();
  });

  it("rejects unsupported operations, scopes, and extra target identities", () => {
    for (const value of [
      null, [], {}, { operation: "delete", scope: "personal" },
      { operation: "apply", scope: "tenant", appearance: personal },
      { operation: "apply", scope: "personal" },
      { operation: "apply", scope: "personal", appearance: personal, ownerId: "another" },
      { operation: "reset", scope: "global", appearance: personal },
      { operation: "reset", scope: "global", expectedOwnerId: "not-an-id" },
      Object.assign(Object.create({ operation: "reset", scope: "global" }), { a: 1, b: 2 }),
    ]) expect(parseAppearanceUpdate(value)).toBeNull();
    expect(parseAppearanceUpdate({ operation: "apply", scope: "personal", appearance: personal }))
      .toStrictEqual({ operation: "apply", scope: "personal", appearance: personal });
    expect(parseAppearanceUpdate({ operation: "reset", scope: "global" }))
      .toStrictEqual({ operation: "reset", scope: "global" });
  });
});

describe("responsive width presets", () => {
  it("defines the existing cap, available full width, and narrower focused cap centrally", () => {
    expect(WIDTH_OPTIONS.map(({ value, label, maxWidth }) => ({ value, label, maxWidth }))).toStrictEqual([
      { value: "default", label: "Default Width", maxWidth: "96rem" },
      { value: "full", label: "Full Width", maxWidth: "none" },
      { value: "focused", label: "Focused Width", maxWidth: "72rem" },
    ]);
    expect(DEFAULT_APPEARANCE.width).toBe("default");
  });
});

describe("appearance precedence", () => {
  it("prefers a personal override, then global, then Light/Emerald", () => {
    expect(resolveAppearance(personal, global)).toStrictEqual({ appearance: personal, source: "personal" });
    expect(resolveAppearance(null, global)).toStrictEqual({ appearance: global, source: "global" });
    expect(resolveAppearance(null, null)).toStrictEqual({ appearance: DEFAULT_APPEARANCE, source: "default" });
  });

  it("ignores invalid saved data at each precedence level", () => {
    expect(resolveAppearance({ theme: "invalid", accent: "emerald" }, global))
      .toStrictEqual({ appearance: global, source: "global" });
    expect(resolveAppearance(personal, { theme: "invalid" }))
      .toStrictEqual({ appearance: personal, source: "personal" });
    expect(resolveAppearance({}, {})).toStrictEqual({ appearance: DEFAULT_APPEARANCE, source: "default" });
  });

  it("returns independent values so an unsaved edit cannot change the default or saved source", () => {
    const result = resolveAppearance(personal, global);
    result.appearance.theme = "light";
    expect(personal.theme).toBe("dark");
    const fallback = resolveAppearance(null, null);
    fallback.appearance.theme = "dark";
    expect(DEFAULT_APPEARANCE.theme).toBe("light");
  });
});

import { describe, expect, it } from "vitest";
import {
  ACCENT_OPTIONS,
  DEFAULT_APPEARANCE,
  parseAppearance,
  parseAppearanceUpdate,
  resolveAppearance,
} from "@/lib/appearance/preferences";

const personal = { theme: "dark", accent: "violet" } as const;
const global = { theme: "system", accent: "blue" } as const;

describe("supported appearance values", () => {
  it("supports only the complete, exact theme/accent combinations", () => {
    for (const theme of ["light", "dark", "system"] as const) {
      for (const { value: accent } of ACCENT_OPTIONS) {
        expect(parseAppearance({ theme, accent })).toStrictEqual({ theme, accent });
      }
    }
  });

  it.each([
    null, undefined, [], "dark", {}, { theme: "dark" },
    { theme: "DARK", accent: "emerald" }, { theme: " dark", accent: "emerald" },
    { theme: "light", accent: "#047857" }, { theme: "light", accent: "Emerald" },
    { theme: "dark", accent: "violet", ownerId: "someone-else" },
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

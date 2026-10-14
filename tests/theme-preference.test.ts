import { describe, expect, it } from "vitest";
import { parseTheme, THEME_COOKIE_NAME, themeCookie } from "@/app/platform/theme-preference";

describe("the platform theme preference", () => {
  it("is dark only for the exact cookie value 'dark'", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    for (const value of [undefined, "", "DARK", " dark", "dark ", "system", "1"]) {
      expect(parseTheme(value)).toBe("light");
    }
  });

  it("is stored for a year under /platform, same-site lax", () => {
    expect(THEME_COOKIE_NAME).toBe("md_platform_theme");
    expect(themeCookie("dark")).toBe("md_platform_theme=dark; path=/platform; max-age=31536000; samesite=lax");
    expect(themeCookie("light")).toBe("md_platform_theme=light; path=/platform; max-age=31536000; samesite=lax");
  });
});

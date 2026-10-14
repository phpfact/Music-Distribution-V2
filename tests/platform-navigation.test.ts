import { describe, expect, it } from "vitest";
import { getInitials } from "@/app/platform/(console)/_components/initials";
import {
  findActiveNavItem,
  getNavItem,
  isNavItemActive,
  PLATFORM_NAV_ITEMS,
} from "@/app/platform/(console)/navigation";

describe("the platform navigation", () => {
  it("has one item per id, each under /platform/", () => {
    const ids = PLATFORM_NAV_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of PLATFORM_NAV_ITEMS) {
      expect(item.href).toMatch(/^\/platform\/[a-z-]+$/);
      expect(getNavItem(item.id)).toBe(item);
    }
  });

  it("offers only the dashboard so far; every other module is planned", () => {
    const available = PLATFORM_NAV_ITEMS.filter((item) => item.status === "available");
    expect(available.map((item) => item.id)).toEqual(["dashboard"]);
  });
});

describe("isNavItemActive", () => {
  const tenants = getNavItem("tenants");

  it.each([
    ["/platform/tenants", true],
    ["/platform/tenants/", true],
    ["/platform/tenants//", true],
    ["/platform/tenants/abc", true],
    ["/platform/tenants/abc/edit", true],
    // Matched on whole segments only.
    ["/platform/tenantsx", false],
    ["/platform/tenants-archive", false],
    ["/platform", false],
    ["/platform/", false],
    ["/", false],
    ["", false],
    ["/platform/dashboard", false],
    ["/tenants", false],
    ["/other/platform/tenants", false],
  ])("for Tenant Management on %j: %s", (pathname, expected) => {
    expect(isNavItemActive(tenants, pathname)).toBe(expected);
  });
});

describe("findActiveNavItem", () => {
  it.each([
    ["/platform/dashboard", "dashboard"],
    ["/platform/dashboard/", "dashboard"],
    ["/platform/roles", "roles"],
    ["/platform/subscriptions/plans/1", "subscriptions"],
    ["/platform/settings", "settings"],
    ["/platform/support/", "support"],
  ])("finds the item for %j", (pathname, id) => {
    expect(findActiveNavItem(pathname)?.id).toBe(id);
  });

  it.each(["/platform", "/platform/login", "/platform/dashboardx", "/"])(
    "finds none for %j",
    (pathname) => {
      expect(findActiveNavItem(pathname)).toBeUndefined();
    },
  );
});

describe("getInitials", () => {
  it.each([
    ["owner", "OW"],
    ["Owner", "OW"],
    ["jane.doe", "JD"],
    ["jane_doe", "JD"],
    ["jane-doe", "JD"],
    ["jane doe smith", "JD"],
    ["  jane   doe ", "JD"],
    ["a", "A"],
    ["x.", "X"],
    [".x", "X"],
    ["", "?"],
    ["._- ", "?"],
  ])("turns %j into %j", (name, expected) => {
    expect(getInitials(name)).toBe(expected);
  });
});

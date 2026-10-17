import { describe, expect, it } from "vitest";
import { getInitials } from "@/app/platform/(console)/_components/initials";
import {
  filterNavSections,
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

  it("offers dashboard, tenant management, roles, sub-platform owners and settings; other modules remain planned", () => {
    const available = PLATFORM_NAV_ITEMS.filter((item) => item.status === "available");
    expect(available.map((item) => item.id)).toEqual(["dashboard", "tenants", "roles", "users", "settings"]);
  });

  it("gates each managed module by its privilege (role-privilege-management.md, Navigation)", () => {
    expect(getNavItem("tenants").permission).toBe("platform.tenants.view");
    expect(getNavItem("roles").permission).toBe("platform.roles.view");
    expect(getNavItem("users").permission).toBe("platform.users.view");
    expect(getNavItem("dashboard").permission).toBeUndefined();
    expect(getNavItem("subscriptions").permission).toBeUndefined();
    expect(getNavItem("settings").children?.map((child) => [child.href, child.permission])).toEqual([
      ["/platform/settings/appearance", undefined],
      ["/platform/settings/modules", "platform.modules.manage"],
    ]);
  });
});

describe("filterNavSections", () => {
  const ids = (permissions: string[]) =>
    filterNavSections(permissions).flatMap((section) => section.items.map((item) => item.id));

  it("shows only ungated items without privileges", () => {
    expect(ids([])).toEqual(["dashboard", "subscriptions", "settings", "support"]);
    const settings = filterNavSections([]).flatMap((section) => section.items).find((item) => item.id === "settings");
    expect(settings?.children?.map((child) => child.label)).toEqual(["Appearance"]);
  });

  it("adds each gated item and child only with its privilege", () => {
    expect(ids(["platform.tenants.view"])).toEqual(["dashboard", "tenants", "subscriptions", "settings", "support"]);
    expect(ids(["platform.roles.view", "platform.users.view"])).toEqual([
      "dashboard", "roles", "users", "subscriptions", "settings", "support",
    ]);
    const settings = filterNavSections(["platform.modules.manage"]).flatMap((section) => section.items).find((item) => item.id === "settings");
    expect(settings?.children?.map((child) => child.label)).toEqual(["Appearance", "Modules"]);
  });

  it("finds the active item only among the visible ones when asked", () => {
    const visible = filterNavSections([]).flatMap((section) => section.items);
    expect(findActiveNavItem("/platform/tenants/abc", visible)).toBeUndefined();
    expect(findActiveNavItem("/platform/tenants/abc")?.id).toBe("tenants");
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
    ["/platform/settings/appearance", "settings"],
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

/**
 * The client-safe role editor rules (src/lib/authz/role-rules.ts) and the
 * sub-user form rules (src/lib/authz/sub-user-rules.ts).
 */
import { describe, expect, it } from "vitest";
import { dependencyClosure } from "@/lib/authz/catalog";
import {
  clearDependents,
  dependentsOf,
  isReservedRoleName,
  normalizeRoleName,
  ROLE_DESCRIPTION_MAX_LENGTH,
  ROLE_NAME_MAX_LENGTH,
  roleNameComparisonKey,
  toggleSelection,
  validateRoleDescription,
  validateRoleName,
  validateRoleStatus,
} from "@/lib/authz/role-rules";
import {
  subUserFieldError,
  subUserFieldsFor,
  validateSubUserFields,
  type SubUserFields,
} from "@/lib/authz/sub-user-rules";

describe("role name rule", () => {
  it("trims, collapses inner spaces and accepts the allowed characters", () => {
    expect(validateRoleName("  Sales   Team  ")).toEqual({ ok: true, value: "Sales Team" });
    expect(validateRoleName("Ops (L2) - A&R_team. O'Neil")).toEqual({ ok: true, value: "Ops (L2) - A&R_team. O'Neil" });
    expect(validateRoleName("Équipe Ventes 2")).toEqual({ ok: true, value: "Équipe Ventes 2" });
  });

  it("rejects empty, whitespace-only, too short and too long names", () => {
    expect(validateRoleName("")).toEqual({ ok: false, error: "Enter a role name." });
    expect(validateRoleName("    ")).toEqual({ ok: false, error: "Enter a role name." });
    expect(validateRoleName("ab").ok).toBe(false);
    expect(validateRoleName("a".repeat(ROLE_NAME_MAX_LENGTH)).ok).toBe(true);
    expect(validateRoleName("a".repeat(ROLE_NAME_MAX_LENGTH + 1)).ok).toBe(false);
  });

  it("rejects characters outside the rule and control characters", () => {
    for (const name of ["Sales/Team", "Admin<script>", "Role#1", "Role@x", "Line\tbreak", "a\nb c"]) {
      expect(validateRoleName(name).ok, name).toBe(false);
    }
  });

  it("reserves the master role names case- and space-insensitively", () => {
    expect(isReservedRoleName("Master Platform")).toBe(true);
    expect(isReservedRoleName("  master   TENANT ")).toBe(true);
    expect(isReservedRoleName("Master Customer")).toBe(true);
    expect(isReservedRoleName("Master Customers")).toBe(false);
    expect(validateRoleName("master platform").ok).toBe(false);
  });

  it("builds a stable comparison key", () => {
    expect(normalizeRoleName("  A   B ")).toBe("A B");
    expect(roleNameComparisonKey("  Sales   TEAM ")).toBe(roleNameComparisonKey("sales team"));
  });
});

describe("role description and status rules", () => {
  it("treats empty or whitespace-only descriptions as null and trims the rest", () => {
    expect(validateRoleDescription("")).toEqual({ ok: true, value: null });
    expect(validateRoleDescription("   \n ")).toEqual({ ok: true, value: null });
    expect(validateRoleDescription("  Handles\nreleases  ")).toEqual({ ok: true, value: "Handles\nreleases" });
  });

  it("enforces the 500 character limit and rejects other control characters", () => {
    expect(validateRoleDescription("x".repeat(ROLE_DESCRIPTION_MAX_LENGTH)).ok).toBe(true);
    expect(validateRoleDescription("x".repeat(ROLE_DESCRIPTION_MAX_LENGTH + 1)).ok).toBe(false);
    expect(validateRoleDescription("bad\u0007bell").ok).toBe(false);
  });

  it("accepts only active and disabled", () => {
    expect(validateRoleStatus("active")).toEqual({ ok: true, value: "active" });
    expect(validateRoleStatus("disabled")).toEqual({ ok: true, value: "disabled" });
    expect(validateRoleStatus("deleted").ok).toBe(false);
  });
});

describe("privilege selection helpers", () => {
  const ALL_TENANT_PLATFORM = new Set(
    [...dependencyClosure(["platform.tenants.credentials", "platform.tenants.edit", "platform.tenant_registrations.review"])],
  );

  it("ticking adds the requires closure (catalog dependencyClosure)", () => {
    const next = toggleSelection([], "platform.tenant_registrations.review", true, ALL_TENANT_PLATFORM);
    expect([...next].sort()).toEqual(
      ["platform.tenant_registrations.review", "platform.tenant_registrations.view", "platform.tenants.view"].sort(),
    );
  });

  it("ticking never adds a privilege the actor cannot assign", () => {
    const assignable = new Set(["platform.tenants.edit"]);
    const next       = toggleSelection([], "platform.tenants.edit", true, assignable);
    expect([...next]).toEqual(["platform.tenants.edit"]);
  });

  it("clearing a required privilege clears its transitive dependents", () => {
    expect(dependentsOf("platform.tenants.view").has("platform.tenant_registrations.review")).toBe(true);
    const selected = ["platform.tenants.view", "platform.tenants.edit", "platform.tenant_registrations.view", "platform.tenant_registrations.review", "platform.appearance.manage_global"];
    const next     = clearDependents(selected, "platform.tenants.view");
    expect([...next]).toEqual(["platform.appearance.manage_global"]);
    // The original selection is not mutated.
    expect(selected).toHaveLength(5);
  });

  it("un-ticking a leaf privilege removes only that privilege", () => {
    const next = toggleSelection(["platform.tenants.view", "platform.tenants.edit"], "platform.tenants.edit", false, ALL_TENANT_PLATFORM);
    expect([...next]).toEqual(["platform.tenants.view"]);
  });
});

describe("sub-user form rules", () => {
  const ROLE_ID = "0b9c1a7e-2f4d-4c1b-9a3e-5d6f7a8b9c0d";
  const VALID: SubUserFields = {
    fullName: "Asha Rao",
    accountType: "artist",
    username: "asha.rao",
    email: "asha@example.com",
    password: "Correct-Horse-42",
    confirmPassword: "Correct-Horse-42",
    roleId: ROLE_ID,
  };

  it("lists the fields per variant and mode", () => {
    expect(subUserFieldsFor("platform", "create")).toEqual(["fullName", "username", "password", "confirmPassword", "roleId"]);
    expect(subUserFieldsFor("tenant", "create")).toEqual(["fullName", "username", "email", "password", "confirmPassword", "roleId"]);
    expect(subUserFieldsFor("customer", "create")).toEqual(["fullName", "accountType", "username", "email", "password", "confirmPassword", "roleId"]);
    expect(subUserFieldsFor("customer", "edit")).toEqual(["fullName", "password", "confirmPassword", "roleId"]);
  });

  it("accepts a valid form and reports each invalid field", () => {
    expect(validateSubUserFields(VALID, "customer", "create")).toEqual({});
    const errors = validateSubUserFields(
      { ...VALID, fullName: "  ", accountType: "", email: "x", confirmPassword: "nope", roleId: "" },
      "customer",
      "create",
    );
    expect(Object.keys(errors).sort()).toEqual(["accountType", "confirmPassword", "email", "fullName", "roleId"].sort());
  });

  it("requires exactly one UUID role id", () => {
    expect(subUserFieldError("roleId", { ...VALID, roleId: "not-a-uuid" }, "create")).toBe("Choose a role.");
    expect(subUserFieldError("roleId", { ...VALID, roleId: `${ROLE_ID},${ROLE_ID}` }, "create")).toBe("Choose a role.");
  });

  it("makes the password pair optional on edit until one is typed", () => {
    const empty = { ...VALID, password: "", confirmPassword: "" };
    expect(validateSubUserFields(empty, "tenant", "edit")).toEqual({});
    expect(validateSubUserFields({ ...empty, password: "Correct-Horse-42" }, "tenant", "edit")).toEqual({
      confirmPassword: "Confirm the password.",
    });
    // On edit the password may not contain the stored username.
    const containsName = { ...VALID, password: "asha.rao-Secret-1", confirmPassword: "asha.rao-Secret-1" };
    expect(subUserFieldError("password", containsName, "edit", "asha.rao")).toBeDefined();
  });
});

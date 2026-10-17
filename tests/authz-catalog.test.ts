/**
 * The permission catalog (src/lib/authz/catalog.ts) and its control-plane
 * mirror (`platform_permissions`, written by the rbac migration)
 * (.vibe/memory/role-privilege-management.md, "Permission catalog").
 * The tenant-database mirror is checked against a provisioned tenant in
 * tests/authz-tenant.test.ts.
 */
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AUTHZ_DOMAINS,
  CATALOG_MODULES,
  CATALOG_PERMISSIONS,
  dependencyClosure,
  getModule,
  getPermission,
  isCoreModule,
  isKnownPermission,
  moduleOfPermission,
  modulesOfDomain,
  permissionKeysOfDomain,
  permissionsOfDomain,
  validatePermissionSelection,
} from "@/lib/authz/catalog";
import { connectToTestDatabase } from "./support/postgres";

let db: Client;

beforeAll(async () => {
  db = await connectToTestDatabase();
});

afterAll(async () => {
  await db.end();
});

describe("catalog structure", () => {
  it("lists exactly the modules of the spec, with their core flags", () => {
    expect(CATALOG_MODULES.map((module) => [module.key, module.core])).toStrictEqual([
      ["platform.tenants", false],
      ["platform.tenant_registrations", false],
      ["platform.tenant_modules", false],
      ["platform.appearance", false],
      ["platform.roles", true],
      ["platform.users", true],
      ["platform.modules", true],
      ["tenant.registrations", false],
      ["tenant.appearance", false],
      ["tenant.roles", true],
      ["tenant.users", true],
      ["customer.roles", true],
      ["customer.sub_customers", true],
    ]);
  });

  it("lists exactly the privileges of the spec, per domain", () => {
    expect(permissionKeysOfDomain("platform")).toStrictEqual([
      "platform.tenants.view",
      "platform.tenants.create",
      "platform.tenants.edit",
      "platform.tenants.suspend",
      "platform.tenants.provision",
      "platform.tenants.credentials",
      "platform.tenant_registrations.view",
      "platform.tenant_registrations.review",
      "platform.tenant_registrations.suspend",
      "platform.tenant_modules.manage",
      "platform.appearance.manage_global",
      "platform.roles.view",
      "platform.roles.create",
      "platform.roles.edit",
      "platform.roles.delete",
      "platform.users.view",
      "platform.users.create",
      "platform.users.edit",
      "platform.users.suspend",
      "platform.modules.manage",
    ]);
    expect(permissionKeysOfDomain("tenant")).toStrictEqual([
      "tenant.registrations.view",
      "tenant.registrations.review",
      "tenant.registrations.suspend",
      "tenant.appearance.manage_workspace",
      "tenant.roles.view",
      "tenant.roles.create",
      "tenant.roles.edit",
      "tenant.roles.delete",
      "tenant.users.view",
      "tenant.users.create",
      "tenant.users.edit",
      "tenant.users.suspend",
    ]);
    expect(permissionKeysOfDomain("customer")).toStrictEqual([
      "customer.roles.view",
      "customer.roles.create",
      "customer.roles.edit",
      "customer.roles.delete",
      "customer.sub_customers.view",
      "customer.sub_customers.create",
      "customer.sub_customers.edit",
      "customer.sub_customers.suspend",
    ]);
  });

  it("keeps every key in the <module>.<action> form, unique, and inside its module's domain", () => {
    const keys = CATALOG_PERMISSIONS.map((permission) => permission.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const permission of CATALOG_PERMISSIONS) {
      expect(permission.key).toBe(`${permission.module}.${permission.action}`);
      expect(getModule(permission.module)?.domain).toBe(permission.domain);
      expect(permission.key.startsWith(`${permission.domain}.`)).toBe(true);
    }
    for (const domain of AUTHZ_DOMAINS) {
      expect(modulesOfDomain(domain).every((module) => module.domain === domain)).toBe(true);
      expect(permissionsOfDomain(domain).every((permission) => permission.domain === domain)).toBe(true);
    }
  });

  it("makes every non-view privilege of a module with a view privilege require that view", () => {
    for (const permission of CATALOG_PERMISSIONS) {
      const view = `${permission.module}.view`;
      if (permission.action !== "view" && getPermission(view)) {
        expect(permission.requires, permission.key).toContain(view);
      }
    }
    // The explicit cross-module dependencies of the spec.
    expect(getPermission("platform.tenant_registrations.view")?.requires).toStrictEqual(["platform.tenants.view"]);
    expect(getPermission("platform.tenant_modules.manage")?.requires).toStrictEqual(["platform.tenants.view"]);
  });

  it("only requires known privileges of the same domain", () => {
    for (const permission of CATALOG_PERMISSIONS) {
      for (const required of permission.requires) {
        expect(getPermission(required)?.domain, `${permission.key} → ${required}`).toBe(permission.domain);
      }
    }
  });
});

describe("catalog helpers", () => {
  it("tells modules and core modules apart, unknown keys included", () => {
    expect(moduleOfPermission("platform.roles.edit")).toBe("platform.roles");
    expect(moduleOfPermission("platform.unknown.view")).toBeNull();
    expect(isCoreModule("platform.roles")).toBe(true);
    expect(isCoreModule("platform.users")).toBe(true);
    expect(isCoreModule("platform.modules")).toBe(true);
    expect(isCoreModule("tenant.users")).toBe(true);
    expect(isCoreModule("customer.sub_customers")).toBe(true);
    expect(isCoreModule("platform.tenants")).toBe(false);
    expect(isCoreModule("tenant.registrations")).toBe(false);
    expect(isCoreModule("nope")).toBe(false);
  });

  it("knows a privilege only inside its own domain", () => {
    expect(isKnownPermission("platform", "platform.tenants.view")).toBe(true);
    expect(isKnownPermission("tenant", "platform.tenants.view")).toBe(false);
    expect(isKnownPermission("customer", "tenant.roles.view")).toBe(false);
    expect(isKnownPermission("tenant", "tenant.roles.view")).toBe(true);
    for (const junk of ["", "platform.tenants", "PLATFORM.TENANTS.VIEW", null, 42, undefined, ["platform.tenants.view"]]) {
      expect(isKnownPermission("platform", junk)).toBe(false);
    }
  });

  it("expands a selection with every transitive dependency and ignores unknown keys", () => {
    expect([...dependencyClosure(["platform.tenant_registrations.review", "bogus.key"])].sort()).toStrictEqual([
      "platform.tenant_registrations.review",
      "platform.tenant_registrations.view",
      "platform.tenants.view",
    ]);
    expect(dependencyClosure([]).size).toBe(0);
  });

  it("validates a selection: unknown, other-domain and missing dependencies are reported", () => {
    expect(validatePermissionSelection("platform", ["platform.roles.edit", "platform.roles.view", "platform.roles.view"])).toStrictEqual({
      ok: true,
      keys: ["platform.roles.view", "platform.roles.edit"],
    });
    expect(validatePermissionSelection("platform", ["platform.roles.edit"])).toStrictEqual({
      ok: false,
      unknown: [],
      missing: [{ key: "platform.roles.edit", missing: ["platform.roles.view"] }],
    });
    expect(validatePermissionSelection("tenant", ["tenant.roles.view", "customer.roles.view", "x"])).toStrictEqual({
      ok: false,
      unknown: ["customer.roles.view", "x"],
      missing: [],
    });
  });
});

describe("control-plane mirror", () => {
  it("platform_permissions is identical to the platform catalog", async () => {
    const rows = await db.query<{
      key: string;
      module_key: string;
      action: string;
      label: string;
      description: string | null;
      sort_order: number;
    }>("SELECT key, module_key, action, label, description, sort_order FROM platform_permissions ORDER BY sort_order, key");
    expect(rows.rows).toStrictEqual(
      permissionsOfDomain("platform").map((permission) => ({
        key: permission.key,
        module_key: permission.module,
        action: permission.action,
        label: permission.label,
        description: permission.description,
        sort_order: permission.sortOrder,
      })),
    );
  });

  it("has exactly one Master Platform role, recognised by its system key", async () => {
    const roles = await db.query("SELECT name, status, system_key FROM platform_roles WHERE system_key IS NOT NULL");
    expect(roles.rows).toStrictEqual([{ name: "Master Platform", status: "active", system_key: "master_platform" }]);
  });
});

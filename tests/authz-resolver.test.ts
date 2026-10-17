/**
 * The pure authorization decision (src/lib/authz/resolver.ts,
 * .vibe/memory/role-privilege-management.md "Authorization decision"):
 * master roles, custom roles, unknown keys, role states, module switches,
 * deny by default and the fingerprint. No database.
 */
import { describe, expect, it } from "vitest";
import {
  AUTHZ_DOMAINS,
  CATALOG_PERMISSIONS,
  MASTER_SYSTEM_KEYS,
  permissionKeysOfDomain,
  type AuthzDomain,
  type DomainPermissionKey,
} from "@/lib/authz/catalog";
import {
  FORBIDDEN_MESSAGE,
  forbiddenMessage,
  NO_ACTIVE_ROLE_MESSAGE,
  resolveEffectiveAccess,
  type RoleSnapshot,
} from "@/lib/authz/resolver";
import { resolveWorkspaceAccess } from "@/lib/authz/workspace-access";
import type { WorkspaceRole } from "@/lib/workspace/sessions";

const ROLE_ID = "019ba263-00e2-7b41-9fc9-2a4b47b5e301";

/** A role snapshot with sensible defaults. */
function role(overrides: Partial<RoleSnapshot> & Pick<RoleSnapshot, "domain">): RoleSnapshot {
  return { id: ROLE_ID, status: "active", systemKey: null, permissionKeys: [], ...overrides };
}

/** A master role of the given domain. */
function master(domain: AuthzDomain): RoleSnapshot {
  return role({ domain, systemKey: MASTER_SYSTEM_KEYS[domain] });
}

/** Every catalog key outside the given domain. */
function keysOutside(domain: AuthzDomain): string[] {
  return CATALOG_PERMISSIONS.filter((permission) => permission.domain !== domain).map((permission) => permission.key);
}

describe("master roles", () => {
  it.each(AUTHZ_DOMAINS)("the %s master holds every key of its domain and none of another domain", (domain) => {
    const access = resolveEffectiveAccess({ domain, role: master(domain), disabledModules: [] });
    expect(access).toMatchObject({ roleState: "active", isMaster: true, roleId: ROLE_ID });
    expect(access.permissions).toStrictEqual(permissionKeysOfDomain(domain));
    for (const key of keysOutside(domain)) {
      expect(access.can(key as DomainPermissionKey<typeof domain>), key).toBe(false);
    }
  });

  it("a master role's stored keys are irrelevant (privileges come from the system key)", () => {
    const access = resolveEffectiveAccess({
      domain: "platform",
      role: { ...master("platform"), permissionKeys: ["tenant.roles.view", "garbage"] },
      disabledModules: [],
    });
    expect(access.permissions).toStrictEqual(permissionKeysOfDomain("platform"));
    expect(access.can("tenant.roles.view" as never)).toBe(false);
  });

  it("another domain's master key is never trusted", () => {
    const access = resolveEffectiveAccess({
      domain: "platform",
      role: role({ domain: "platform", systemKey: MASTER_SYSTEM_KEYS.tenant }),
      disabledModules: [],
    });
    expect(access).toMatchObject({ roleState: "invalid", isMaster: false, permissions: [] });
  });
});

describe("custom roles", () => {
  it("grant exactly their stored keys that exist in the domain's catalog, in catalog order", () => {
    const access = resolveEffectiveAccess({
      domain: "tenant",
      role: role({
        domain: "tenant",
        permissionKeys: ["tenant.users.view", "tenant.registrations.view", "tenant.unknown.view", "platform.roles.view", "customer.roles.view"],
      }),
      disabledModules: [],
    });
    expect(access).toMatchObject({ roleState: "active", isMaster: false });
    expect(access.permissions).toStrictEqual(["tenant.registrations.view", "tenant.users.view"]);
    expect(access.can("tenant.users.view")).toBe(true);
    expect(access.can("tenant.users.edit")).toBe(false);
  });

  it("deny by default: unknown and malformed keys are never allowed", () => {
    const access = resolveEffectiveAccess({ domain: "platform", role: master("platform"), disabledModules: [] });
    for (const key of ["", "platform", "platform.tenants", "platform.tenants.destroy", "PLATFORM.TENANTS.VIEW", "tenant.roles.view"]) {
      expect(access.can(key as never), key).toBe(false);
    }
  });
});

describe("role states (fail secure)", () => {
  it("a missing role grants nothing", () => {
    expect(resolveEffectiveAccess({ domain: "tenant", role: null, disabledModules: [] })).toMatchObject({
      roleState: "missing",
      roleId: null,
      isMaster: false,
      permissions: [],
    });
  });

  it("a disabled role grants nothing (custom role)", () => {
    const access = resolveEffectiveAccess({
      domain: "platform",
      role: role({ domain: "platform", status: "disabled", permissionKeys: ["platform.tenants.view"] }),
      disabledModules: [],
    });
    expect(access).toMatchObject({ roleState: "disabled", permissions: [] });
    expect(access.can("platform.tenants.view")).toBe(false);
  });

  it.each([
    ["platform", "tenant"],
    ["tenant", "customer"],
    ["customer", "tenant"],
    ["tenant", "platform"],
  ] as const)("a %s session with a %s role grants nothing", (domain, roleDomain) => {
    const access = resolveEffectiveAccess({ domain, role: master(roleDomain), disabledModules: [] });
    expect(access).toMatchObject({ roleState: "invalid", isMaster: false, permissions: [] });
  });

  it("a role outside the person's scope grants nothing", () => {
    const access = resolveEffectiveAccess({
      domain: "customer",
      role: role({ domain: "customer", permissionKeys: ["customer.roles.view"] }),
      inScope: false,
      disabledModules: [],
    });
    expect(access).toMatchObject({ roleState: "invalid", permissions: [] });
  });
});

describe("module switches", () => {
  it("remove a disabled module's privileges, also from a master role", () => {
    const access = resolveEffectiveAccess({
      domain: "platform",
      role: master("platform"),
      disabledModules: ["platform.tenants", "platform.appearance"],
    });
    expect(access.isMaster).toBe(true);
    expect(access.permissions.some((key) => key.startsWith("platform.tenants."))).toBe(false);
    expect(access.can("platform.appearance.manage_global")).toBe(false);
    expect(access.can("platform.tenant_registrations.view")).toBe(true);
  });

  it("ignore a setting for a core module (nobody can be locked out)", () => {
    const access = resolveEffectiveAccess({
      domain: "tenant",
      role: master("tenant"),
      disabledModules: ["tenant.roles", "tenant.users", "tenant.registrations"],
    });
    expect(access.can("tenant.roles.edit")).toBe(true);
    expect(access.can("tenant.users.create")).toBe(true);
    expect(access.can("tenant.registrations.view")).toBe(false);
  });

  it("ignore unknown module keys and modules of another domain", () => {
    const access = resolveEffectiveAccess({
      domain: "customer",
      role: master("customer"),
      disabledModules: ["customer.nope", "tenant.registrations", "platform.tenants"],
    });
    expect(access.permissions).toStrictEqual(permissionKeysOfDomain("customer"));
  });
});

describe("fingerprint and messages", () => {
  it("is stable for the same decision and changes when the privileges or role state change", () => {
    const keys  = ["platform.users.view", "platform.tenants.view"];
    const first = resolveEffectiveAccess({ domain: "platform", role: role({ domain: "platform", permissionKeys: keys }), disabledModules: [] });
    const again = resolveEffectiveAccess({ domain: "platform", role: role({ domain: "platform", permissionKeys: [...keys].reverse() }), disabledModules: [] });
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(again.fingerprint).toBe(first.fingerprint);

    const fewer    = resolveEffectiveAccess({ domain: "platform", role: role({ domain: "platform", permissionKeys: ["platform.tenants.view"] }), disabledModules: [] });
    const disabled = resolveEffectiveAccess({ domain: "platform", role: role({ domain: "platform", permissionKeys: keys, status: "disabled" }), disabledModules: [] });
    const switched = resolveEffectiveAccess({ domain: "platform", role: role({ domain: "platform", permissionKeys: keys }), disabledModules: ["platform.tenants"] });
    expect(new Set([first.fingerprint, fewer.fingerprint, disabled.fingerprint, switched.fingerprint]).size).toBe(4);
  });

  it("explains a refusal without internal details", () => {
    expect(forbiddenMessage({ roleState: "active" })).toBe(FORBIDDEN_MESSAGE);
    for (const state of ["missing", "disabled", "invalid"] as const) {
      expect(forbiddenMessage({ roleState: state })).toBe(NO_ACTIVE_ROLE_MESSAGE);
    }
  });
});

describe("workspace users", () => {
  const MAIN_ID  = "019ba263-00e2-7b41-9fc9-2a4b47b5e401";
  const OTHER_ID = "019ba263-00e2-7b41-9fc9-2a4b47b5e402";
  const SUB_ID   = "019ba263-00e2-7b41-9fc9-2a4b47b5e403";

  /** A custom customer role owned by the given main customer. */
  function customerRole(owner: string): WorkspaceRole {
    return {
      id: ROLE_ID,
      name: "Custom customer role",
      domain: "customer",
      status: "active",
      systemKey: null,
      ownerCustomerId: owner,
      permissionKeys: ["customer.sub_customers.view"],
    };
  }

  it("a sub-customer's user may hold a custom role of its MAIN customer", () => {
    const user = { role: customerRole(MAIN_ID), customer: { id: SUB_ID, type: "artist" as const, name: "Sub", parentId: MAIN_ID } };
    expect(resolveWorkspaceAccess(user, "customer", []).permissions).toStrictEqual(["customer.sub_customers.view"]);
  });

  it("a custom customer role of another main customer grants nothing", () => {
    const user = { role: customerRole(OTHER_ID), customer: { id: MAIN_ID, type: "label" as const, name: "Main", parentId: null } };
    expect(resolveWorkspaceAccess(user, "customer", [])).toMatchObject({ roleState: "invalid", permissions: [] });
  });

  it("a staff user with a customer role grants nothing", () => {
    const user = { role: customerRole(MAIN_ID), customer: null };
    expect(resolveWorkspaceAccess(user, "tenant", [])).toMatchObject({ roleState: "invalid", permissions: [] });
  });
});

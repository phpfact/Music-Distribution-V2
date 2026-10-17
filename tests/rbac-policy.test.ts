/**
 * The pure delegation-ceiling policy (src/lib/authz/policy.ts,
 * .vibe/memory/role-privilege-management.md "Delegation ceiling"): no
 * database, every rule decided from plain facts.
 */
import { describe, expect, it } from "vitest";
import { permissionKeysOfDomain } from "@/lib/authz/catalog";
import {
  checkRoleAssignable,
  checkRoleManageable,
  checkUserManageable,
  finalStoredKeys,
  isRoleAssignable,
  isRoleManageable,
  isUserManageable,
  parseSingleRoleId,
  privilegeLockReason,
  roleCeilingKeys,
  validatePrivilegeRequest,
  validateRoleFields,
  type PolicyActor,
  type PolicyRole,
} from "@/lib/authz/policy";

const ROLE_A  = "11111111-1111-4111-8111-111111111111";
const ROLE_B  = "22222222-2222-4222-8222-222222222222";
const MAIN_X  = "33333333-3333-4333-8333-333333333333";
const MAIN_Y  = "44444444-4444-4444-8444-444444444444";
const USER_ME = "55555555-5555-4555-8555-555555555555";
const USER_2  = "66666666-6666-4666-8666-666666666666";

/** A tenant actor holding a custom role with the given privileges. */
function tenantActor(permissions: string[], extra: Partial<PolicyActor> = {}): PolicyActor {
  return { domain: "tenant", userId: USER_ME, roleId: ROLE_A, isMaster: false, permissions, disabledModules: [], mainCustomerId: null, ...extra };
}

/** A custom role of a domain. */
function role(id: string, keys: string[], extra: Partial<PolicyRole> = {}): PolicyRole {
  return { id, domain: "tenant", systemKey: null, status: "active", ownerCustomerId: null, permissionKeys: keys, ...extra };
}

const MASTER_TENANT: PolicyRole = role("77777777-7777-4777-8777-777777777777", [], { systemKey: "master_tenant" });

describe("privilege requests", () => {
  const actor = tenantActor(["tenant.roles.view", "tenant.roles.create", "tenant.users.view", "tenant.registrations.view"]);

  it("accepts keys inside the ceiling, in catalog order", () => {
    const result = validatePrivilegeRequest(actor, ["tenant.users.view", "tenant.roles.view"]);
    expect(result).toStrictEqual({
      ok: true,
      requestedKeys: ["tenant.roles.view", "tenant.users.view"],
      preservedKeys: [],
      finalKeys: ["tenant.roles.view", "tenant.users.view"],
    });
  });

  it("rejects empty, unknown, other-domain, above-ceiling keys and missing requires with typed reasons", () => {
    expect(validatePrivilegeRequest(actor, [])).toMatchObject({ ok: false, problem: "empty", escalation: false });
    expect(validatePrivilegeRequest(actor, [""])).toMatchObject({ ok: false, problem: "empty" });
    expect(validatePrivilegeRequest(actor, ["tenant.roles.fly"])).toMatchObject({ ok: false, problem: "unknown", escalation: true, keys: ["tenant.roles.fly"] });
    expect(validatePrivilegeRequest(actor, [42])).toMatchObject({ ok: false, problem: "unknown" });
    expect(validatePrivilegeRequest(actor, ["platform.tenants.view"])).toMatchObject({ ok: false, problem: "other_domain", escalation: true });
    expect(validatePrivilegeRequest(actor, ["customer.roles.view"])).toMatchObject({ ok: false, problem: "other_domain" });
    expect(validatePrivilegeRequest(actor, ["tenant.roles.view", "tenant.roles.delete"])).toMatchObject({
      ok: false,
      problem: "above_ceiling",
      keys: ["tenant.roles.delete"],
    });
    expect(validatePrivilegeRequest(actor, ["tenant.roles.create"])).toMatchObject({ ok: false, problem: "missing_requires", escalation: false });
    // A single string (not an array) is one entry.
    expect(validatePrivilegeRequest(actor, "tenant.roles.view")).toMatchObject({ ok: true, finalKeys: ["tenant.roles.view"] });
  });

  it("rejects disabled-module keys and preserves (never adds) the role's existing ones", () => {
    const limited = tenantActor(["tenant.roles.view", "tenant.users.view"], { disabledModules: ["tenant.registrations"] });
    expect(validatePrivilegeRequest(limited, ["tenant.registrations.view"])).toMatchObject({ ok: false, problem: "module_disabled", escalation: true });

    // Existing role keeps its registrations key; a role without it does not get it.
    const kept = validatePrivilegeRequest(limited, ["tenant.roles.view"], ["tenant.roles.view", "tenant.registrations.view", "tenant.users.view"]);
    expect(kept).toMatchObject({ ok: true, preservedKeys: ["tenant.registrations.view"], finalKeys: ["tenant.registrations.view", "tenant.roles.view"] });
    const notAdded = validatePrivilegeRequest(limited, ["tenant.roles.view"], ["tenant.users.view"]);
    expect(notAdded).toMatchObject({ ok: true, preservedKeys: [], finalKeys: ["tenant.roles.view"] });

    // Core modules are never disabled.
    const coreOff = tenantActor(["tenant.roles.view"], { disabledModules: ["tenant.roles"] });
    expect(validatePrivilegeRequest(coreOff, ["tenant.roles.view"])).toMatchObject({ ok: true });
    expect(finalStoredKeys("tenant", [], ["tenant.roles.view"], ["tenant.roles"]).preservedKeys).toStrictEqual([]);
  });

  it("names the lock reason of a privilege for the editor", () => {
    const limited = tenantActor(["tenant.roles.view"], { disabledModules: ["tenant.registrations"] });
    expect(privilegeLockReason(limited, "tenant.roles.view")).toBeNull();
    expect(privilegeLockReason(limited, "tenant.roles.create")).toBe("outside_privileges");
    expect(privilegeLockReason(limited, "tenant.registrations.view")).toBe("module_disabled");
  });
});

describe("roles: assignable and manageable", () => {
  const actor = tenantActor(["tenant.roles.view", "tenant.roles.edit", "tenant.users.view"]);

  it("assignable: in scope, active, within the ceiling; master only for master holders", () => {
    expect(isRoleAssignable(actor, role(ROLE_B, ["tenant.users.view"]))).toBe(true);
    expect(checkRoleAssignable(actor, role(ROLE_B, ["tenant.users.create"]))).toStrictEqual({ ok: false, reason: "above_ceiling" });
    expect(checkRoleAssignable(actor, role(ROLE_B, ["tenant.users.view"], { status: "disabled" }))).toStrictEqual({ ok: false, reason: "inactive_role" });
    expect(checkRoleAssignable(actor, MASTER_TENANT)).toStrictEqual({ ok: false, reason: "master_requires_master" });
    expect(isRoleAssignable({ ...actor, isMaster: true }, MASTER_TENANT)).toBe(true);
    expect(checkRoleAssignable(actor, role(ROLE_B, [], { domain: "customer", ownerCustomerId: MAIN_X }))).toStrictEqual({ ok: false, reason: "out_of_scope" });
    // A role holding a disabled-module key is still assignable: the inert key does not count.
    const withDisabled = { ...actor, disabledModules: ["tenant.registrations"] };
    expect(isRoleAssignable(withDisabled, role(ROLE_B, ["tenant.users.view", "tenant.registrations.view"]))).toBe(true);
    expect(roleCeilingKeys(role(ROLE_B, ["tenant.registrations.view", "unknown.key"]), ["tenant.registrations"])).toStrictEqual([]);
  });

  it("manageable: never the own role, a system role or a role above the ceiling", () => {
    expect(isRoleManageable(actor, role(ROLE_B, ["tenant.roles.view"]))).toBe(true);
    expect(checkRoleManageable(actor, role(ROLE_A, ["tenant.roles.view"]))).toStrictEqual({ ok: false, reason: "own_role" });
    expect(checkRoleManageable({ ...actor, isMaster: true }, MASTER_TENANT)).toStrictEqual({ ok: false, reason: "system_role" });
    expect(checkRoleManageable(actor, role(ROLE_B, ["tenant.roles.delete"]))).toStrictEqual({ ok: false, reason: "above_ceiling" });
  });

  it("customer scope: Master Customer and the actor's main customer's roles only", () => {
    const customer: PolicyActor = { ...actor, domain: "customer", permissions: permissionKeysOfDomain("customer"), mainCustomerId: MAIN_X };
    expect(isRoleManageable(customer, role(ROLE_B, ["customer.roles.view"], { domain: "customer", ownerCustomerId: MAIN_X }))).toBe(true);
    expect(checkRoleManageable(customer, role(ROLE_B, ["customer.roles.view"], { domain: "customer", ownerCustomerId: MAIN_Y }))).toStrictEqual({
      ok: false,
      reason: "out_of_scope",
    });
    expect(checkRoleAssignable(customer, role(ROLE_B, [], { domain: "customer", systemKey: "master_customer" }))).toStrictEqual({
      ok: false,
      reason: "master_requires_master",
    });
  });
});

describe("users: manageable", () => {
  const actor = tenantActor(["tenant.users.view", "tenant.users.edit"]);

  it("never self, never primary, master holders only by masters, else within the ceiling", () => {
    const base = { id: USER_2, isPrimary: false, inScope: true };
    expect(isUserManageable(actor, { ...base, role: role(ROLE_B, ["tenant.users.view"]) })).toBe(true);
    expect(isUserManageable(actor, { ...base, role: null })).toBe(true);
    expect(checkUserManageable(actor, { ...base, id: USER_ME, role: null })).toStrictEqual({ ok: false, reason: "self" });
    expect(checkUserManageable({ ...actor, isMaster: true }, { ...base, isPrimary: true, role: MASTER_TENANT })).toStrictEqual({ ok: false, reason: "primary" });
    expect(checkUserManageable(actor, { ...base, role: MASTER_TENANT })).toStrictEqual({ ok: false, reason: "master_requires_master" });
    expect(isUserManageable({ ...actor, isMaster: true }, { ...base, role: MASTER_TENANT })).toBe(true);
    expect(checkUserManageable(actor, { ...base, role: role(ROLE_B, ["tenant.users.suspend"]) })).toStrictEqual({ ok: false, reason: "above_ceiling" });
    expect(checkUserManageable(actor, { ...base, inScope: false, role: null })).toStrictEqual({ ok: false, reason: "out_of_scope" });
  });
});

describe("role fields and the single role id", () => {
  it("validates name, description and status; master names are reserved (case, spaces)", () => {
    expect(validateRoleFields({ name: "  Sales   Team ", description: "", status: "active" })).toStrictEqual({
      ok: true,
      value: { name: "Sales Team", description: null, status: "active" },
    });
    expect(validateRoleFields({ name: "master   PLATFORM", description: "", status: "active" })).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String) } });
    expect(validateRoleFields({ name: "Master Customer", description: "", status: "active" })).toMatchObject({ ok: false });
    expect(validateRoleFields({ name: ["x"], description: 5, status: "busy" })).toMatchObject({
      ok: false,
      fieldErrors: { name: expect.any(String), status: expect.any(String) },
    });
  });

  it("parseSingleRoleId accepts exactly one UUID string", () => {
    expect(parseSingleRoleId([ROLE_A.toUpperCase()])).toStrictEqual({ ok: true, roleId: ROLE_A });
    expect(parseSingleRoleId(` ${ROLE_A} `)).toStrictEqual({ ok: true, roleId: ROLE_A });
    expect(parseSingleRoleId([])).toMatchObject({ ok: false, error: "Choose a role." });
    expect(parseSingleRoleId([ROLE_A, ROLE_B])).toMatchObject({ ok: false, error: "Choose exactly one role." });
    expect(parseSingleRoleId([ROLE_A, ROLE_A])).toMatchObject({ ok: false });
    expect(parseSingleRoleId(["not-a-uuid"])).toMatchObject({ ok: false });
    expect(parseSingleRoleId(undefined)).toMatchObject({ ok: false });
    expect(parseSingleRoleId(123)).toMatchObject({ ok: false });
    expect(parseSingleRoleId([new Blob(["x"])])).toMatchObject({ ok: false });
  });
});

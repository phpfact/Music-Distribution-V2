/**
 * The delegation-ceiling policy of role and sub-user management
 * (.vibe/memory/role-privilege-management.md, "Business rules" → "Single
 * role", "Master roles and primary accounts", "Delegation ceiling").
 *
 * Pure decisions only: no `server-only`, no `node:` imports, no database. The
 * services (role-service.ts, sub-user-service.ts) load the facts fresh inside
 * their transactions and ask these functions; the UI may import the same
 * functions to hide actions it would be refused anyway (the server always
 * decides again).
 *
 *   - assignable: may the actor give role R to a user?
 *   - manageable (role): may the actor edit / disable / delete role R?
 *   - manageable (user): may the actor edit / suspend / re-role user U?
 *   - privilege request: may the actor store this privilege set on a role?
 *
 * The same rules serve all three domains (platform, tenant, customer).
 */
import {
  getPermission,
  isCoreModule,
  MASTER_SYSTEM_KEYS,
  moduleOfPermission,
  permissionKeysOfDomain,
  validatePermissionSelection,
  type AuthzDomain,
  type MissingDependency,
} from "./catalog";
import { validateRoleDescription, validateRoleName, validateRoleStatus, type RoleStatus } from "./role-rules";
import { isUuid } from "@/lib/uuid";

// ---------------------------------------------------------------------------
// Facts the policy decides on

/** The acting person as the policy sees them (always built on the server). */
export type PolicyActor = {
  domain: AuthzDomain;
  /** The actor's own user id (platform owner id or tenant-database user id). */
  userId: string;
  /** The actor's own role id (also when it grants nothing), or null. */
  roleId: string | null;
  /** True only while the actor holds the active master role of the domain. */
  isMaster: boolean;
  /** The actor's CURRENT effective privileges (the delegation ceiling). */
  permissions: readonly string[];
  /** Module keys switched off centrally for this actor's panel. */
  disabledModules: readonly string[];
  /** Customer domain only: COALESCE(parent_id, id) of the actor's customer; null otherwise. */
  mainCustomerId: string | null;
};

/** A role as the policy sees it. */
export type PolicyRole = {
  id: string;
  domain: AuthzDomain;
  /** The protected key of a master role; null for custom roles. */
  systemKey: string | null;
  status: "active" | "disabled";
  /** Customer domain only: the main customer owning a custom role; null otherwise. */
  ownerCustomerId: string | null;
  /** The privilege keys stored on the role (ignored for a master role). */
  permissionKeys: readonly string[];
};

/** A target user as the policy sees it. */
export type PolicyUser = {
  id: string;
  isPrimary: boolean;
  /** False when the user is outside the actor's scope (decided by the store's scoped query). */
  inScope: boolean;
  /** The user's single role, or null when none is assigned. */
  role: PolicyRole | null;
};

/** Why the policy refused. */
export type PolicyDenial =
  | "out_of_scope"
  | "inactive_role"
  | "system_role"
  | "own_role"
  | "master_requires_master"
  | "above_ceiling"
  | "self"
  | "primary";

/** A policy decision with a typed reason. */
export type PolicyDecision = { ok: true } | { ok: false; reason: PolicyDenial };

/** Friendly, non-revealing messages for every denial (shown to the user as is). */
export const POLICY_DENIAL_MESSAGES: Record<PolicyDenial, string> = {
  out_of_scope: "This item is not available in your account.",
  inactive_role: "This role is disabled. Choose an active role.",
  system_role: "System roles cannot be changed.",
  own_role: "You cannot change the role you hold.",
  master_requires_master: "Only a holder of the master role can assign it or manage its holders.",
  above_ceiling: "This role has privileges beyond your own, so you cannot use or change it.",
  self: "You cannot change your own account here.",
  primary: "The primary account is protected and cannot be changed here.",
};

// ---------------------------------------------------------------------------
// Small helpers

/**
 * Description: Tell whether a module is switched off centrally (core modules never are).
 * Input: A module key and the disabled module keys of the actor's panel.
 * Output: True only for a listed, non-core module.
 * Use case: Privilege validation, preserved keys and editor lock reasons.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function isModuleDisabled(moduleKey: string, disabledModules: readonly string[]): boolean {
  return disabledModules.includes(moduleKey) && !isCoreModule(moduleKey);
}

/**
 * Description: Tell whether a privilege belongs to a centrally disabled module.
 * Input: A privilege key and the disabled module keys.
 * Output: True when the key's module is disabled (false for unknown keys).
 * Use case: validatePrivilegeRequest, finalStoredKeys, privilegeLockReason.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function isKeyOfDisabledModule(key: string, disabledModules: readonly string[]): boolean {
  const moduleKey = moduleOfPermission(key);
  return moduleKey !== null && isModuleDisabled(moduleKey, disabledModules);
}

/**
 * Description: Tell whether a role is its domain's master role.
 * Input: The role.
 * Output: True only when its system key is the master key of ITS OWN domain
 *   (a name never makes a role master).
 * Use case: Every decision below; the services' "System" flags.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function isMasterRole(role: Pick<PolicyRole, "domain" | "systemKey">): boolean {
  return role.systemKey !== null && role.systemKey === MASTER_SYSTEM_KEYS[role.domain];
}

/**
 * Description: Tell whether a role lies inside the actor's scope.
 * Input: The actor and the role.
 * Output: True when the role is of the actor's domain and — customer domain —
 *   is Master Customer or a custom role owned by the actor's main customer;
 *   tenant/platform custom roles never have an owner customer.
 * Use case: checkRoleAssignable, checkRoleManageable (the stores also scope
 *   their queries; this is the second, independent check).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function isRoleInScope(actor: Pick<PolicyActor, "domain" | "mainCustomerId">, role: PolicyRole): boolean {
  // Step 1: a role of another domain is never usable here.
  if (role.domain !== actor.domain) return false;
  // Step 2: a system key that is not this domain's master key is never trusted.
  if (role.systemKey !== null && !isMasterRole(role)) return false;
  // Step 3: master roles are shared by the whole domain (one per database).
  if (isMasterRole(role)) return true;
  // Step 4: custom customer roles belong to exactly one main customer.
  if (actor.domain === "customer") return role.ownerCustomerId !== null && role.ownerCustomerId === actor.mainCustomerId;
  // Step 5: custom platform/tenant roles never carry an owner customer.
  return role.ownerCustomerId === null;
}

/**
 * Description: List the privileges a role counts with against a delegation ceiling.
 * Input: The role and the centrally disabled modules of the actor's panel.
 * Output: Master role → every privilege of its domain; custom role → its stored
 *   keys that exist in its domain's catalog. In both cases WITHOUT the keys of
 *   disabled modules (they are inert, so they never block anybody).
 * Use case: Ceiling comparisons; the "privilege count" of roles.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function roleCeilingKeys(role: PolicyRole, disabledModules: readonly string[]): string[] {
  // Step 1: the base set (master = whole domain; custom = stored ∩ catalog).
  const catalogKeys = permissionKeysOfDomain(role.domain) as string[];
  const stored      = new Set(role.permissionKeys);
  const base        = isMasterRole(role) ? catalogKeys : catalogKeys.filter((key) => stored.has(key));
  // Step 2: drop the inert keys of disabled modules.
  return base.filter((key) => !isKeyOfDisabledModule(key, disabledModules));
}

/**
 * Description: Tell whether every privilege of a role lies within the actor's ceiling.
 * Input: The actor and the role.
 * Output: True when roleCeilingKeys(role) ⊆ actor.permissions.
 * Use case: checkRoleAssignable, checkRoleManageable, checkUserManageable.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function isWithinCeiling(actor: Pick<PolicyActor, "permissions" | "disabledModules">, role: PolicyRole): boolean {
  const ceiling = new Set(actor.permissions);
  return roleCeilingKeys(role, actor.disabledModules).every((key) => ceiling.has(key));
}

// ---------------------------------------------------------------------------
// Roles: assignable and manageable

/**
 * Description: Decide whether the actor may assign a role to a user.
 * Input: The actor and the role (loaded fresh by the caller).
 * Output: ok, or the reason: out_of_scope, inactive_role, master_requires_master
 *   (master role, actor not a master holder) or above_ceiling (a custom role
 *   with privileges outside the actor's effective set).
 * Use case: Sub-user create/edit (role picker), delete-with-replacement.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function checkRoleAssignable(actor: PolicyActor, role: PolicyRole): PolicyDecision {
  // Step 1: the role must be in the actor's domain scope.
  if (!isRoleInScope(actor, role)) return { ok: false, reason: "out_of_scope" };
  // Step 2: a disabled role grants nothing, so it is never handed out.
  if (role.status !== "active") return { ok: false, reason: "inactive_role" };
  // Step 3: the master role only travels from one master holder to another user.
  if (isMasterRole(role)) return actor.isMaster ? { ok: true } : { ok: false, reason: "master_requires_master" };
  // Step 4: a custom role must lie within the actor's ceiling.
  return isWithinCeiling(actor, role) ? { ok: true } : { ok: false, reason: "above_ceiling" };
}

/**
 * Description: Boolean form of checkRoleAssignable.
 * Input: The actor and the role.
 * Output: True when the actor may assign the role.
 * Use case: Role pickers and quick UI checks.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function isRoleAssignable(actor: PolicyActor, role: PolicyRole): boolean {
  return checkRoleAssignable(actor, role).ok;
}

/**
 * Description: Decide whether the actor may edit, disable, enable or delete a role.
 * Input: The actor and the role (loaded fresh by the caller).
 * Output: ok, or the reason: out_of_scope, system_role (master/system roles are
 *   never mutable), own_role (nobody changes the role they hold) or above_ceiling.
 * Use case: Role update, status change and delete; the list's "manageable" flag.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function checkRoleManageable(actor: PolicyActor, role: PolicyRole): PolicyDecision {
  // Step 1: other domains and other main customers' roles are invisible.
  if (!isRoleInScope(actor, role)) return { ok: false, reason: "out_of_scope" };
  // Step 2: master (system) roles are fixed by the migrations.
  if (role.systemKey !== null) return { ok: false, reason: "system_role" };
  // Step 3: the actor's own role is never changed by the actor.
  if (actor.roleId !== null && role.id === actor.roleId) return { ok: false, reason: "own_role" };
  // Step 4: a role above the actor's ceiling stays out of reach.
  return isWithinCeiling(actor, role) ? { ok: true } : { ok: false, reason: "above_ceiling" };
}

/**
 * Description: Boolean form of checkRoleManageable.
 * Input: The actor and the role.
 * Output: True when the actor may edit/disable/delete the role.
 * Use case: Row menus and the details page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function isRoleManageable(actor: PolicyActor, role: PolicyRole): boolean {
  return checkRoleManageable(actor, role).ok;
}

// ---------------------------------------------------------------------------
// Users: manageable

/**
 * Description: Decide whether the actor may edit, suspend, reactivate or re-role a user.
 * Input: The actor and the target user (scope, primary flag and current role).
 * Output: ok, or the reason: out_of_scope, self, primary, master_requires_master
 *   (the target holds the master role) or above_ceiling (the target's role has
 *   privileges outside the actor's effective set). A user without a role is
 *   manageable (nothing to protect above the actor).
 * Use case: Sub-user update and status change; the list's "manageable" flag.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function checkUserManageable(actor: PolicyActor, target: PolicyUser): PolicyDecision {
  // Step 1: only users inside the actor's scope.
  if (!target.inScope) return { ok: false, reason: "out_of_scope" };
  // Step 2: nobody manages their own account through RBAC paths.
  if (target.id === actor.userId) return { ok: false, reason: "self" };
  // Step 3: primary accounts are lockout-protected.
  if (target.isPrimary) return { ok: false, reason: "primary" };
  // Step 4: no role → nothing above the actor.
  if (!target.role) return { ok: true };
  // Step 5: a role of another domain/scope means the user is not ours to manage.
  if (target.role.domain !== actor.domain) return { ok: false, reason: "out_of_scope" };
  // Step 6: master holders are managed by master holders only.
  if (isMasterRole(target.role)) return actor.isMaster ? { ok: true } : { ok: false, reason: "master_requires_master" };
  // Step 7: otherwise the target's role must lie within the actor's ceiling.
  return isWithinCeiling(actor, target.role) ? { ok: true } : { ok: false, reason: "above_ceiling" };
}

/**
 * Description: Boolean form of checkUserManageable.
 * Input: The actor and the target user.
 * Output: True when the actor may manage the user.
 * Use case: Row actions of the sub-user lists.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function isUserManageable(actor: PolicyActor, target: PolicyUser): boolean {
  return checkUserManageable(actor, target).ok;
}

// ---------------------------------------------------------------------------
// Privilege requests (role create / edit)

/** Why a privilege request was refused. */
export type PrivilegeRequestProblem =
  | "empty"
  | "unknown"
  | "other_domain"
  | "module_disabled"
  | "above_ceiling"
  | "missing_requires";

/** The outcome of validating a role's privilege selection. */
export type PrivilegeRequestResult =
  | {
      ok: true;
      /** The submitted keys, de-duplicated, in catalog order. */
      requestedKeys: string[];
      /** Existing keys of disabled modules kept unchanged (never added). */
      preservedKeys: string[];
      /** What is stored: requested ∪ preserved, in catalog order. */
      finalKeys: string[];
    }
  | {
      ok: false;
      problem: PrivilegeRequestProblem;
      /** The offending keys (for the audit row; never shown raw to users). */
      keys: string[];
      /** missing_requires only: which selected keys miss which requirements. */
      missing: MissingDependency[];
      /** True for unknown / other-domain / disabled-module / above-ceiling keys: audited as an escalation attempt. */
      escalation: boolean;
      /** Friendly message for the Privileges field. */
      message: string;
    };

/** Messages of the privilege field (friendly; the keys go to the audit log only). */
export const PRIVILEGE_REQUEST_MESSAGES: Record<PrivilegeRequestProblem, string> = {
  empty: "Select at least one privilege.",
  unknown: "Some selected privileges do not exist. Refresh the page and select again.",
  other_domain: "Some selected privileges belong to another panel and cannot be granted here.",
  module_disabled: "Some selected privileges belong to a module disabled by the Platform Owner.",
  above_ceiling: "You can only grant privileges that you have yourself.",
  missing_requires: "Some selected privileges need another privilege (for example View). Select the required privileges too.",
};

/**
 * Description: Turn a submitted privilege value into a list of raw entries.
 * Input: Anything (FormData.getAll array, a single string, or garbage).
 * Output: The entries as an array (a single value becomes a one-item array;
 *   null/undefined becomes empty). Entries are NOT validated here.
 * Use case: validatePrivilegeRequest.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function entriesOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

/**
 * Description: Compute the privilege set that is stored when a role is saved.
 * Input: The domain, the validated requested keys, the role's existing stored
 *   keys (empty on create) and the disabled modules.
 * Output: requested ∪ (existing keys of currently DISABLED modules), in catalog
 *   order. Disabled-module keys are preserved unchanged, never added.
 * Use case: validatePrivilegeRequest; the editor's review step.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function finalStoredKeys(
  domain: AuthzDomain,
  requestedKeys: readonly string[],
  existingKeys: readonly string[],
  disabledModules: readonly string[],
): { preservedKeys: string[]; finalKeys: string[] } {
  // Step 1: existing keys of disabled modules (known keys of this domain only).
  const requested = new Set(requestedKeys);
  const catalog   = permissionKeysOfDomain(domain) as string[];
  const existing  = new Set(existingKeys);
  const preserved = catalog.filter(
    (key) => existing.has(key) && !requested.has(key) && isKeyOfDisabledModule(key, disabledModules),
  );
  // Step 2: the union, in catalog order.
  const union = new Set([...requested, ...preserved]);
  return { preservedKeys: preserved, finalKeys: catalog.filter((key) => union.has(key)) };
}

/**
 * Description: Validate the privileges an actor wants to store on a custom role.
 * Input: The actor (domain, ceiling, disabled modules), the submitted value
 *   (untrusted: usually FormData.getAll("permissions")) and, on edit, the
 *   role's existing stored keys.
 * Output: ok with requested / preserved / final keys, or the FIRST problem in
 *   this order: empty, unknown (not in the catalog or not a string),
 *   other_domain, module_disabled, above_ceiling, missing_requires (checked on
 *   the final set). Never auto-adds anything.
 * Use case: createRole / updateRole (inside the transaction, against the
 *   ceiling read fresh there).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function validatePrivilegeRequest(
  actor: Pick<PolicyActor, "domain" | "permissions" | "disabledModules">,
  submitted: unknown,
  existingKeys: readonly string[] = [],
): PrivilegeRequestResult {
  // Step 1: raw entries; non-strings count as unknown keys.
  const entries  = entriesOf(submitted);
  const unique   = new Set<string>();
  const unknown: string[] = [];
  for (const entry of entries) {
    // An empty value (e.g. a hidden "nothing selected" field) selects nothing.
    if (entry === "") continue;
    if (typeof entry === "string") unique.add(entry);
    else unknown.push(String(entry));
  }

  // Step 2: at least one privilege per custom role.
  if (unique.size === 0 && unknown.length === 0) return refuse("empty", []);

  // Step 3: classify every key (the first category found wins below).
  const ceiling = new Set(actor.permissions);
  const otherDomain: string[] = [];
  const disabled: string[]    = [];
  const above: string[]       = [];
  for (const key of unique) {
    const permission = getPermission(key);
    if (!permission) unknown.push(key);
    else if (permission.domain !== actor.domain) otherDomain.push(key);
    else if (isModuleDisabled(permission.module, actor.disabledModules)) disabled.push(key);
    else if (!ceiling.has(key)) above.push(key);
  }
  if (unknown.length > 0) return refuse("unknown", unknown);
  if (otherDomain.length > 0) return refuse("other_domain", otherDomain);
  if (disabled.length > 0) return refuse("module_disabled", disabled);
  if (above.length > 0) return refuse("above_ceiling", above);

  // Step 4: the stored set keeps the role's disabled-module keys.
  const requestedKeys = (permissionKeysOfDomain(actor.domain) as string[]).filter((key) => unique.has(key));
  const stored        = finalStoredKeys(actor.domain, requestedKeys, existingKeys, actor.disabledModules);

  // Step 5: `requires` dependencies must be satisfied by what is stored.
  const selection = validatePermissionSelection(actor.domain, stored.finalKeys);
  if (!selection.ok) {
    const missingKeys = selection.missing.map((entry) => entry.key as string);
    return { ...refuse("missing_requires", missingKeys), missing: selection.missing };
  }
  return { ok: true, requestedKeys, preservedKeys: stored.preservedKeys, finalKeys: stored.finalKeys };
}

/**
 * Description: Build a refused privilege-request result.
 * Input: The problem and the offending keys.
 * Output: The failure shape with its friendly message and escalation flag.
 * Use case: validatePrivilegeRequest.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function refuse(problem: PrivilegeRequestProblem, keys: string[]): Extract<PrivilegeRequestResult, { ok: false }> {
  // Unknown, foreign, disabled and above-ceiling keys are escalation attempts (audited).
  const escalation = problem === "unknown" || problem === "other_domain" || problem === "module_disabled" || problem === "above_ceiling";
  return { ok: false, problem, keys, missing: [], escalation, message: PRIVILEGE_REQUEST_MESSAGES[problem] };
}

/** Why the role editor shows a privilege as locked (not a checkbox). */
export type PrivilegeLockReason = "outside_privileges" | "module_disabled";

/**
 * Description: Tell why the actor may not grant one privilege (if at all).
 * Input: The actor and a privilege key of the actor's domain.
 * Output: null when assignable; "module_disabled" when its module is switched
 *   off centrally (takes precedence); "outside_privileges" when the actor lacks it.
 * Use case: The role editor model (locked "Not assignable" group).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function privilegeLockReason(
  actor: Pick<PolicyActor, "permissions" | "disabledModules">,
  key: string,
): PrivilegeLockReason | null {
  if (isKeyOfDisabledModule(key, actor.disabledModules)) return "module_disabled";
  return actor.permissions.includes(key) ? null : "outside_privileges";
}

// ---------------------------------------------------------------------------
// Role fields (name, description, status) — rules from role-rules.ts

/** The editable fields of a role form plus the selections the services check. */
export type RoleFieldName   = "name" | "description" | "status" | "permissions" | "replacementRoleId";
export type RoleFieldErrors = Partial<Record<RoleFieldName, string>>;

/** The validated text fields of a role. */
export type ValidRoleFields = { name: string; description: string | null; status: RoleStatus };

/**
 * Description: Validate a role's name, description and status together.
 * Input: The raw submitted values (anything; non-strings count as empty).
 * Output: The normalized values, or one message per invalid field. The name
 *   rule (role-rules.ts) rejects master role names case-insensitively with
 *   collapsed spaces; uniqueness per scope is checked by the services.
 * Use case: createRole / updateRole.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function validateRoleFields(input: {
  name: unknown;
  description: unknown;
  status: unknown;
}): { ok: true; value: ValidRoleFields } | { ok: false; fieldErrors: RoleFieldErrors } {
  // Step 1: every field through its shared rule.
  const name        = validateRoleName(typeof input.name === "string" ? input.name : "");
  const description = validateRoleDescription(typeof input.description === "string" ? input.description : "");
  const status      = validateRoleStatus(typeof input.status === "string" ? input.status : "");

  // Step 2: one message per invalid field.
  const fieldErrors: RoleFieldErrors = {};
  if (!name.ok) fieldErrors.name = name.error;
  if (!description.ok) fieldErrors.description = description.error;
  if (!status.ok) fieldErrors.status = status.error;
  if (!name.ok || !description.ok || !status.ok) return { ok: false, fieldErrors };
  return { ok: true, value: { name: name.value, description: description.value, status: status.value } };
}

// ---------------------------------------------------------------------------
// Exactly one role id

/** The outcome of reading a submitted role id. */
export type SingleRoleIdResult = { ok: true; roleId: string } | { ok: false; error: string };

/** Shown when the role selection is missing, repeated or malformed. */
export const SINGLE_ROLE_MESSAGES = {
  missing: "Choose a role.",
  multiple: "Choose exactly one role.",
} as const;

/**
 * Description: Read exactly one role id from a submission.
 * Input: FormData.getAll("roleId") (an array) or any other untrusted value.
 * Output: The role id (trimmed, lower-case UUID), or an error: an array with
 *   zero or several entries, a non-string entry (e.g. a File), an empty value
 *   or a malformed UUID is refused. Never picks "the first of many".
 * Use case: Sub-user create/edit and delete-with-replacement.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function parseSingleRoleId(value: FormDataEntryValue[] | unknown): SingleRoleIdResult {
  // Step 1: arrays must hold exactly one entry (repeated fields are refused).
  let entry: unknown = value;
  if (Array.isArray(value)) {
    if (value.length === 0) return { ok: false, error: SINGLE_ROLE_MESSAGES.missing };
    if (value.length > 1) return { ok: false, error: SINGLE_ROLE_MESSAGES.multiple };
    entry = value[0];
  }
  // Step 2: only a string can be an id (Files, numbers and objects are refused).
  if (typeof entry !== "string") return { ok: false, error: SINGLE_ROLE_MESSAGES.missing };
  // Step 3: a canonical UUID.
  const roleId = entry.trim().toLowerCase();
  return isUuid(roleId) ? { ok: true, roleId } : { ok: false, error: SINGLE_ROLE_MESSAGES.missing };
}

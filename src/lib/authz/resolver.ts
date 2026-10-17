/**
 * The authorization decision itself, without any database access
 * (.vibe/memory/role-privilege-management.md, "Authorization decision").
 *
 * The loaders (platform-access.ts, workspace-access.ts) read the signed-in
 * person's single role, its stored privilege keys and the centrally disabled
 * modules FRESH on every request, then call resolveEffectiveAccess(). Keeping
 * the decision pure makes every rule unit-testable and identical for the
 * three domains:
 *
 *   1. (identity: the session check, done by the caller)
 *   2. the role must exist, be active, belong to the session's domain and be
 *      in the person's scope — otherwise the effective set is EMPTY;
 *   3. base set: master role → every catalog privilege of the domain; custom
 *      role → its stored keys ∩ the domain's catalog (unknown keys ignored);
 *   4. minus every privilege of a centrally disabled, NON-core module;
 *   5. deny by default: can(key) is true only for keys in the final set.
 *   6. (resource ownership and scope: checked by the service doing the work)
 */
import { createHash } from "node:crypto";
import {
  isCoreModule,
  MASTER_SYSTEM_KEYS,
  moduleOfPermission,
  permissionKeysOfDomain,
  type AuthzDomain,
  type DomainPermissionKey,
} from "./catalog";

/**
 * Why a person's role does or does not grant anything:
 *   active   — the role counts;
 *   missing  — no role is assigned (or it no longer exists);
 *   disabled — the role was disabled by an administrator;
 *   invalid  — the role belongs to another domain or another customer's scope.
 */
export type RoleState = "active" | "missing" | "disabled" | "invalid";

/** What a loader read about the person's single role (never trusted blindly). */
export type RoleSnapshot = {
  id: string;
  /** The role's own domain (platform roles always "platform"). */
  domain: AuthzDomain;
  status: "active" | "disabled";
  /** The protected key of a master role; null for custom roles. */
  systemKey: string | null;
  /** The privilege keys stored on the role (ignored for a master role). */
  permissionKeys: readonly string[];
};

/** Everything the decision needs. */
export type ResolveAccessInput<D extends AuthzDomain> = {
  /** The domain of the session (platform owner, staff user or customer user). */
  domain: D;
  /** The person's role, or null when none is assigned. */
  role: RoleSnapshot | null;
  /**
   * False when the loader found the role outside the person's scope (a custom
   * customer role owned by another main customer). Defaults to true.
   */
  inScope?: boolean;
  /** Module keys switched off centrally (core modules in here are ignored). */
  disabledModules: Iterable<string>;
};

/** The effective privileges of one person for one request. */
export type EffectiveAccess<D extends AuthzDomain = AuthzDomain> = {
  domain: D;
  /** The assigned role's id (also when it grants nothing), or null. */
  roleId: string | null;
  roleState: RoleState;
  /** True only for an active master role of this domain. */
  isMaster: boolean;
  /** The granted privileges, in catalog order. */
  permissions: readonly DomainPermissionKey<D>[];
  /** Deny by default: true only for a granted privilege of this domain. */
  can: (key: DomainPermissionKey<D>) => boolean;
  /**
   * Stable hash of domain, role id, role state and the sorted privileges.
   * Changes whenever what the person may do changes (for a later UI sync).
   */
  fingerprint: string;
};

/** Shown when a signed-in person lacks a privilege (never reveals details). */
export const FORBIDDEN_MESSAGE = "You do not have permission to perform this action.";

/** Shown when the person's role is missing, disabled or invalid. */
export const NO_ACTIVE_ROLE_MESSAGE =
  "Your account has no active role, so this action is not available. Ask your administrator to assign a role.";

/**
 * Description: Classify the person's role for the decision.
 * Input: The resolve input (session domain, role snapshot, scope flag).
 * Output: active, missing, disabled or invalid (see RoleState).
 * Use case: resolveEffectiveAccess (step 2 of the decision).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function roleStateOf<D extends AuthzDomain>(input: ResolveAccessInput<D>): RoleState {
  const { role, domain } = input;
  // No role assigned: nothing is granted (fail secure).
  if (!role) return "missing";
  // A role of another domain can never authorize anything here.
  if (role.domain !== domain) return "invalid";
  // A custom customer role of another main customer (the loader decides scope).
  if (input.inScope === false) return "invalid";
  // A system key that is not this domain's master key is not trusted.
  if (role.systemKey !== null && role.systemKey !== MASTER_SYSTEM_KEYS[domain]) return "invalid";
  // Disabled roles keep their users signed in but grant nothing.
  if (role.status !== "active") return "disabled";
  return "active";
}

/**
 * Description: Compute the stable fingerprint of an access decision.
 * Input: The domain, the role id, the role state and the granted keys.
 * Output: SHA-256 (hex) of "domain|roleId|state|sorted keys".
 * Use case: resolveEffectiveAccess; a later client sync compares fingerprints.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function accessFingerprint(
  domain: AuthzDomain,
  roleId: string | null,
  roleState: RoleState,
  keys: readonly string[],
): string {
  // Sorted copy: the fingerprint never depends on the order keys were read in.
  const sorted = [...keys].sort();
  const text   = `${domain}|${roleId ?? "-"}|${roleState}|${sorted.join(",")}`;
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Description: Decide the effective privileges of one person (steps 2-5).
 * Input: The session domain, the role snapshot (or null), the scope flag and
 *   the centrally disabled module keys.
 * Output: The effective access: role state, master flag, the granted keys in
 *   catalog order, a deny-by-default can() and the fingerprint. A missing,
 *   disabled, invalid or out-of-scope role always yields an EMPTY set.
 * Use case: Every guard of the three panels (through the loaders).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function resolveEffectiveAccess<D extends AuthzDomain>(input: ResolveAccessInput<D>): EffectiveAccess<D> {
  const { domain, role } = input;

  // Step 1: is the role usable at all? (anything but "active" grants nothing)
  const roleState = roleStateOf(input);
  const isMaster  = roleState === "active" && role?.systemKey === MASTER_SYSTEM_KEYS[domain];

  // Step 2: the base set — every domain privilege for a master role, otherwise
  // the stored keys that exist in this domain's catalog (unknown keys and keys
  // of other domains drop out here).
  const catalogKeys = permissionKeysOfDomain(domain);
  let base: DomainPermissionKey<D>[] = [];
  if (roleState === "active" && isMaster) {
    base = catalogKeys;
  } else if (roleState === "active" && role) {
    const stored = new Set(role.permissionKeys);
    base = catalogKeys.filter((key) => stored.has(key));
  }

  // Step 3: remove the privileges of centrally disabled modules. Core modules
  // can never be disabled, so a setting for one of them is ignored.
  const disabled = new Set(input.disabledModules);
  const granted  = base.filter((key) => {
    const moduleKey = moduleOfPermission(key);
    if (!moduleKey) return false;
    return !(disabled.has(moduleKey) && !isCoreModule(moduleKey));
  });

  // Step 4: deny by default — only keys in the final set are allowed.
  const allowed = new Set<string>(granted);
  return {
    domain,
    roleId: role?.id ?? null,
    roleState,
    isMaster,
    permissions: granted,
    can: (key) => allowed.has(key),
    fingerprint: accessFingerprint(domain, role?.id ?? null, roleState, granted),
  };
}

/**
 * Description: Pick the friendly refusal message for a denied action.
 * Input: The person's effective access.
 * Output: The "no active role" message when the role grants nothing because it
 *   is missing/disabled/invalid, otherwise the generic forbidden message.
 * Use case: authorizePlatformAction / authorizeTenantAction / authorizeCustomerAction.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function forbiddenMessage(access: Pick<EffectiveAccess, "roleState">): string {
  return access.roleState === "active" ? FORBIDDEN_MESSAGE : NO_ACTIVE_ROLE_MESSAGE;
}

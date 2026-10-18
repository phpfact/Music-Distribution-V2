import "server-only";
/**
 * Role management of the three panels: Platform roles, Tenant roles and
 * Customer roles (.vibe/memory/role-privilege-management.md, "Business rules"
 * → "Delegation ceiling", "Role lifecycle"; "UI specs" → roles screens).
 *
 * ONE implementation for all domains; the storage differs per domain through
 * the store of the actor (stores/index.ts). Every function receives the actor
 * built from server-resolved data (actor.ts) and:
 *   1. checks the management privilege itself (defence in depth);
 *   2. mutations: re-reads the actor's ceiling and locks the role INSIDE one
 *      transaction, then applies the pure policy (policy.ts);
 *   3. audits after commit (control plane), escalation attempts included;
 *   4. returns typed results with friendly messages only (technical details
 *      go to the `[rbac]` log).
 * Server Actions stay thin: authorize → build the actor → call one function.
 */
import type { AuditMetadata } from "@/lib/audit";
import { isUuid } from "@/lib/uuid";
import type { AuthzActor } from "./actor";
import { toPolicyActor } from "./actor";
import { modulesOfDomain, permissionKeysOfDomain, permissionsOfDomain } from "./catalog";
import {
  activePrivilegeCount,
  auditAfterCommit,
  forbidden,
  holdsAnyPrivilege,
  holdsPrivilege,
  isUniqueViolation,
  LOAD_FAILED_MESSAGE,
  logFailure,
  pageWindow,
  settleRefusal,
  UNAVAILABLE_MESSAGE,
  type Refusal,
} from "./management-common";
import {
  MANAGEMENT_PAGE_SIZE,
  parseManagementPage,
  MANAGEMENT_SEARCH_MAX_LENGTH,
  ROLE_COUNT_CATEGORIES,
  type AssignableRoleOption,
  type AssignedUserRow,
  type ManagementPage,
  type QueryResult,
  type RoleCountCategory,
  type RoleCountRecords,
  type RoleDetails,
  type RoleDetailsModule,
  type RoleEditorModel,
  type RoleListPage,
  type RoleListQuery,
  type RoleListRow,
  type RoleMutationResult,
  type RoleSummary,
} from "./management-model";
import {
  checkRoleAssignable,
  checkRoleManageable,
  isMasterRole,
  isModuleDisabled,
  parseSingleRoleId,
  POLICY_DENIAL_MESSAGES,
  privilegeLockReason,
  roleCeilingKeys,
  SINGLE_ROLE_MESSAGES,
  validatePrivilegeRequest,
  validateRoleFields,
  type PolicyActor,
  type PolicyDenial,
  type RoleFieldErrors,
} from "./policy";
import { validateRoleStatus } from "./role-rules";
import { storeFor, type StoredRole, type StoredUser } from "./stores";
import type { RoleFilter } from "./stores/types";

/** The submitted role form (untrusted values straight from FormData). */
export type RoleInput = {
  name: unknown;
  description: unknown;
  status: unknown;
  /** Usually FormData.getAll("permissions"). */
  permissions: unknown;
};

/** The submitted delete confirmation. */
export type DeleteRoleInput = {
  /** Usually FormData.getAll("replacementRoleId"); required when users hold the role. */
  replacementRoleId?: unknown;
};

// Friendly messages of this service.
const MESSAGES = {
  notFound: "This role no longer exists. Refresh the page.",
  nameTaken: "Another role already uses this name. Choose another name.",
  sameStatus: "The role already has this status. Refresh the page.",
  replacementRequired: "Choose a replacement role for the users who hold this role.",
  replacementSame: "Choose a different role as the replacement.",
  replacementMissing: "The chosen replacement role is not available. Choose another role.",
} as const;

// ---------------------------------------------------------------------------
// Shaping

/**
 * Description: Turn a stored role into a role list row for this actor.
 * Input: The policy actor and the stored role.
 * Output: The row: effective privileges (master: whole domain), counts and the manageable flag.
 * Use case: listRoles and listRoleCountRecords.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function toListRow(actor: PolicyActor, role: StoredRole): RoleListRow {
  const keys = roleCeilingKeys(role, actor.disabledModules);
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    status: role.status,
    isMaster: isMasterRole(role),
    privilegeCount: isMasterRole(role) ? null : keys.length,
    privilegeKeys: keys,
    userCount: role.userCount,
    manageable: checkRoleManageable(actor, role).ok,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

/**
 * Description: Turn a stored user into an assigned-user row.
 * Input: The stored user.
 * Output: The row (raw username/email: the UI masks them; never a hash).
 * Use case: Role details, listRoleUsers and the "Users assigned" popup.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function toAssignedUser(user: StoredUser): AssignedUserRow {
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    status: user.status,
    isPrimary: user.isPrimary,
    roleId: user.role?.id ?? null,
    roleName: user.role?.name ?? null,
  };
}

/**
 * Description: Group a role's granted privileges by module for the details page.
 * Input: The policy actor and the role.
 * Output: Modules with at least one granted privilege, in catalog order, each
 *   marked `disabled` when switched off centrally (its privileges are inert).
 *   Master role: every privilege of the domain.
 * Use case: getRoleDetails.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function detailModules(actor: PolicyActor, role: StoredRole): RoleDetailsModule[] {
  const stored  = new Set(role.permissionKeys);
  const granted = (key: string): boolean => isMasterRole(role) || stored.has(key);
  const groups: RoleDetailsModule[] = [];
  for (const catalogModule of modulesOfDomain(role.domain)) {
    const privileges = permissionsOfDomain(role.domain)
      .filter((permission) => permission.module === catalogModule.key && granted(permission.key))
      .map((permission) => ({ key: permission.key, label: permission.label, description: permission.description }));
    if (privileges.length === 0) continue;
    groups.push({
      key: catalogModule.key,
      label: catalogModule.label,
      disabled: isModuleDisabled(catalogModule.key, actor.disabledModules),
      privileges,
    });
  }
  return groups;
}

/**
 * Description: Read one page of the users holding roles of this scope.
 * Input: The actor, an optional role id (only its holders) and the page.
 * Output: The page of assigned-user rows.
 * Use case: getRoleDetails, listRoleUsers, the "Users assigned" popup.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
async function assignedUserPage(actor: AuthzActor, roleId: string | null, requestedPage: number): Promise<ManagementPage<AssignedUserRow>> {
  const store  = storeFor(actor);
  const filter = { audience: "role_holders" as const, assignedOnly: true, roleId };
  const total  = await store.countUsers(filter);
  const window = pageWindow(total, requestedPage);
  const users  = await store.listUsers(filter, window.skip, window.take);
  return { rows: users.map(toAssignedUser), total, page: window.page, pageCount: window.pageCount, pageSize: MANAGEMENT_PAGE_SIZE };
}

/**
 * Description: Read one page of roles of this scope with a status filter.
 * Input: The actor, the search text, the status filter and the page.
 * Output: The page of role list rows.
 * Use case: listRoles and the role count popups.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
async function rolePage(actor: AuthzActor, query: RoleListQuery): Promise<ManagementPage<RoleListRow>> {
  const store  = storeFor(actor);
  const policy = toPolicyActor(actor);
  const filter = { q: query.q, status: query.status };
  const total  = await store.countRoles(filter);
  const window = pageWindow(total, query.page);
  const roles  = await store.listRoles(filter, window.skip, window.take);
  return { rows: roles.map((role) => toListRow(policy, role)), total, page: window.page, pageCount: window.pageCount, pageSize: MANAGEMENT_PAGE_SIZE };
}

// ---------------------------------------------------------------------------
// Queries

/**
 * Description: List one page of the roles of the actor's scope.
 * Input: The actor and the list query (search on name/description, status, page).
 * Output: The rows (master first, then name, then id), total, page count and
 *   the domain's active privilege count for "All (N)"; or forbidden / unavailable.
 * Use case: The roles list pages of the three panels (needs *.roles.view).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function listRoles(actor: AuthzActor, query: RoleListQuery): Promise<QueryResult<RoleListPage>> {
  if (!holdsPrivilege(actor, "rolesView")) return forbidden(actor);
  try {
    const page = await rolePage(actor, query);
    return { ok: true, data: { ...page, allPrivilegeCount: activePrivilegeCount(actor.domain, actor.disabledModules) } };
  } catch (error) {
    logFailure(actor, "listing roles", error);
    return { ok: false, reason: "unavailable", error: LOAD_FAILED_MESSAGE };
  }
}

/**
 * Description: Count the roles of the actor's scope for the summary cards.
 * Input: The actor.
 * Output: Total, active, disabled roles and the users holding a role of the scope.
 * Use case: Roles page summary (each figure opens listRoleCountRecords).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function getRoleSummary(actor: AuthzActor): Promise<QueryResult<RoleSummary>> {
  if (!holdsPrivilege(actor, "rolesView")) return forbidden(actor);
  try {
    const store = storeFor(actor);
    // One readable count per figure, with the same conditions as the list filters.
    const total         = await store.countRoles({});
    const active        = await store.countRoles({ status: "active" });
    const disabled      = await store.countRoles({ status: "disabled" });
    const usersAssigned = await store.countUsers({ audience: "role_holders", assignedOnly: true });
    return { ok: true, data: { total, active, disabled, usersAssigned } };
  } catch (error) {
    logFailure(actor, "counting roles", error);
    return { ok: false, reason: "unavailable", error: LOAD_FAILED_MESSAGE };
  }
}

/**
 * Description: List the exact records behind one roles summary figure.
 * Input: The actor, the category (total / active / disabled / users_assigned;
 *   untrusted) and the page (untrusted).
 * Output: A page of roles or of assigned users, plus the calculation text.
 * Use case: CountDetails popups of the roles page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function listRoleCountRecords(
  actor: AuthzActor,
  category: unknown,
  page: unknown,
): Promise<QueryResult<RoleCountRecords>> {
  if (!holdsPrivilege(actor, "rolesView")) return forbidden(actor);
  const known = ROLE_COUNT_CATEGORIES.find((candidate) => candidate === category);
  if (!known) return { ok: false, reason: "validation", error: "Choose a figure to explain." };
  const requestedPage = parseManagementPage(page);
  try {
    if (known === "users_assigned") {
      const users = await assignedUserPage(actor, null, requestedPage);
      return {
        ok: true,
        data: {
          kind: "users",
          category: known,
          calculation: `Users of your account who hold a role: ${users.total}. Each user holds exactly one role.`,
          page: users,
        },
      };
    }
    const status = known === "total" ? "all" : known;
    const roles  = await rolePage(actor, { q: "", status, page: requestedPage });
    return { ok: true, data: { kind: "roles", category: known, calculation: roleCalculation(known, roles.total), page: roles } };
  } catch (error) {
    logFailure(actor, "listing role count records", error);
    return { ok: false, reason: "unavailable", error: LOAD_FAILED_MESSAGE };
  }
}

/**
 * Description: Explain how a role figure is calculated.
 * Input: The category and its total.
 * Output: A short sentence for the popup.
 * Use case: listRoleCountRecords.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function roleCalculation(category: Exclude<RoleCountCategory, "users_assigned">, total: number): string {
  if (category === "active") return `Roles whose status is Active: ${total}.`;
  if (category === "disabled") return `Roles whose status is Disabled: ${total}.`;
  return `Every role of your account, system and custom, active and disabled: ${total}.`;
}

/**
 * Description: Read one role with its privileges and holders for the details page.
 * Input: The actor and the role id (untrusted).
 * Output: The role, its privileges grouped by module (disabled modules marked),
 *   the first page of holders, the affected user count and the manageable flag
 *   with its reason; not_found for an id outside the scope (another tenant,
 *   another main customer or another domain).
 * Use case: /<panel>/roles/[id].
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function getRoleDetails(actor: AuthzActor, roleId: unknown): Promise<QueryResult<RoleDetails>> {
  if (!holdsPrivilege(actor, "rolesView")) return forbidden(actor);
  if (!isUuid(roleId)) return { ok: false, reason: "not_found", error: MESSAGES.notFound };
  try {
    // Step 1: the role inside the actor's scope.
    const role = await storeFor(actor).findRole(roleId);
    if (!role) return { ok: false, reason: "not_found", error: MESSAGES.notFound };

    // Step 2: privileges, holders and the policy decision.
    const policy   = toPolicyActor(actor);
    const decision = checkRoleManageable(policy, role);
    const users    = await assignedUserPage(actor, role.id, 1);
    const keys     = roleCeilingKeys(role, policy.disabledModules);
    return {
      ok: true,
      data: {
        role: {
          id: role.id,
          name: role.name,
          description: role.description,
          status: role.status,
          isMaster: isMasterRole(role),
          privilegeCount: isMasterRole(role) ? null : keys.length,
          createdAt: role.createdAt.toISOString(),
          updatedAt: role.updatedAt.toISOString(),
        },
        modules: detailModules(policy, role),
        assignedUsers: users,
        affectedUserCount: role.userCount,
        manageable: decision.ok,
        manageableReason: decision.ok ? null : decision.reason,
      },
    };
  } catch (error) {
    logFailure(actor, "reading role details", error);
    return { ok: false, reason: "unavailable", error: LOAD_FAILED_MESSAGE };
  }
}

/**
 * Description: List one page of the users holding a role.
 * Input: The actor, the role id and the page (both untrusted).
 * Output: The page of assigned users (inside the scope only), or not_found.
 * Use case: Role details "Assigned users" paging; the disable/delete confirmations.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function listRoleUsers(
  actor: AuthzActor,
  roleId: unknown,
  page: unknown,
): Promise<QueryResult<ManagementPage<AssignedUserRow>>> {
  if (!holdsPrivilege(actor, "rolesView")) return forbidden(actor);
  if (!isUuid(roleId)) return { ok: false, reason: "not_found", error: MESSAGES.notFound };
  try {
    const role = await storeFor(actor).findRole(roleId);
    if (!role) return { ok: false, reason: "not_found", error: MESSAGES.notFound };
    return { ok: true, data: await assignedUserPage(actor, role.id, parseManagementPage(page)) };
  } catch (error) {
    logFailure(actor, "listing role users", error);
    return { ok: false, reason: "unavailable", error: LOAD_FAILED_MESSAGE };
  }
}

/**
 * Description: Build the role editor for creating or editing a role.
 * Input: The actor and, for edit, the role id (untrusted; omit/undefined for create).
 * Output: Every module of the actor's domain with each privilege as assignable
 *   or locked ("outside_privileges" / "module_disabled"), the initial values
 *   (edit: prefilled), the preserved disabled-module keys and the affected user
 *   count; forbidden without *.roles.create / *.roles.edit or when the role is
 *   not manageable; not_found outside the scope.
 * Use case: /<panel>/roles/new and /<panel>/roles/[id]/edit.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function getRoleEditorModel(actor: AuthzActor, roleId?: unknown): Promise<QueryResult<RoleEditorModel>> {
  const mode = roleId === undefined ? "create" : "edit";
  if (!holdsPrivilege(actor, mode === "create" ? "rolesCreate" : "rolesEdit")) return forbidden(actor);
  const policy = toPolicyActor(actor);

  // Step 1: the module cards with the actor's lock reasons.
  const modules = modulesOfDomain(actor.domain).map((catalogModule) => ({
    key: catalogModule.key,
    label: catalogModule.label,
    description: catalogModule.description,
    core: catalogModule.core,
    disabled: isModuleDisabled(catalogModule.key, policy.disabledModules),
    privileges: permissionsOfDomain(actor.domain)
      .filter((permission) => permission.module === catalogModule.key)
      .map((permission) => {
        const lockedReason = privilegeLockReason(policy, permission.key);
        return {
          key: permission.key,
          label: permission.label,
          description: permission.description,
          requires: [...permission.requires],
          assignable: lockedReason === null,
          lockedReason,
        };
      }),
  }));

  // Step 2 (create): empty form, active by default.
  if (mode === "create") {
    return {
      ok: true,
      data: { mode, roleId: null, modules, initial: { name: "", description: "", status: "active", permissionKeys: [] }, preservedKeys: [], affectedUserCount: 0 },
    };
  }

  // Step 3 (edit): the role must exist in the scope and be manageable.
  if (!isUuid(roleId)) return { ok: false, reason: "not_found", error: MESSAGES.notFound };
  try {
    const role = await storeFor(actor).findRole(roleId);
    if (!role) return { ok: false, reason: "not_found", error: MESSAGES.notFound };
    const decision = checkRoleManageable(policy, role);
    if (!decision.ok) return { ok: false, reason: "forbidden", error: POLICY_DENIAL_MESSAGES[decision.reason] };

    // Step 4: selected = stored keys of enabled modules; disabled-module keys are kept aside.
    const catalog  = permissionKeysOfDomain(actor.domain) as string[];
    const stored   = new Set(role.permissionKeys);
    const selected = catalog.filter((key) => stored.has(key) && privilegeLockReason(policy, key) !== "module_disabled");
    const kept     = catalog.filter((key) => stored.has(key) && privilegeLockReason(policy, key) === "module_disabled");
    return {
      ok: true,
      data: {
        mode,
        roleId: role.id,
        modules,
        initial: { name: role.name, description: role.description ?? "", status: role.status, permissionKeys: selected },
        preservedKeys: kept,
        affectedUserCount: role.userCount,
      },
    };
  } catch (error) {
    logFailure(actor, "building the role editor", error);
    return { ok: false, reason: "unavailable", error: LOAD_FAILED_MESSAGE };
  }
}

/**
 * Description: Read the initial page of active, assignable roles for a picker.
 * Input: The actor, optional excluded role and optional saved selected role.
 * Output: Up to twenty choices plus that one saved option when eligible, with
 *   id, name, master flag and privilege count; later choices remain reachable
 *   through searchRoleOptions. Forbidden without delete/create/edit access.
 * Use case: Sub-user form role picker; "Delete and reassign" replacement picker.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function listAssignableRoles(
  actor: AuthzActor,
  options: { excludeRoleId?: string | null; selectedRoleId?: string | null } = {},
): Promise<QueryResult<AssignableRoleOption[]>> {
  const page = await searchRoleOptions(actor, { kind: "assignable", excludeRoleId: options.excludeRoleId });
  if (!page.ok) return page;
  const roles = [...page.data.rows];
  // A saved value may sit on a later page. Fetch only that one scoped, eligible role.
  if (isUuid(options.selectedRoleId) && !roles.some((role) => role.id === options.selectedRoleId)) {
    const selected = await storeFor(actor).findRole(options.selectedRoleId);
    if (selected && checkRoleAssignable(toPolicyActor(actor), selected).ok) {
      roles.push(toRoleOption(toPolicyActor(actor), selected));
    }
  }
  return { ok: true, data: roles };
}

/** The untrusted role-option search, shared by pickers and directory filters. */
export type RoleOptionsQuery = {
  kind?: "assignable" | "filter";
  q?: unknown;
  page?: unknown;
  excludeRoleId?: unknown;
};

/**
 * Description: Map one scoped role to a serializable picker option.
 * Input: The current policy actor and a stored role.
 * Output: Id, name, master flag and effective privilege count.
 * Use case: Initial role choices and paginated role searches.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
function toRoleOption(actor: PolicyActor, role: StoredRole): AssignableRoleOption {
  return {
    id: role.id,
    name: role.name,
    isMaster: isMasterRole(role),
    privilegeCount: isMasterRole(role) ? null : roleCeilingKeys(role, actor.disabledModules).length,
  };
}

/**
 * Description: Search one page of eligible roles entirely in the scoped database.
 * Input: A server-built actor plus untrusted search, page, exclusion and filter purpose.
 * Output: Twenty options and exact pagination metadata, or a friendly refusal.
 * Use case: Every assignment/replacement picker and sub-user directory role filter.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export async function searchRoleOptions(
  actor: AuthzActor,
  query: RoleOptionsQuery = {},
): Promise<QueryResult<ManagementPage<AssignableRoleOption>>> {
  const filtering = query.kind === "filter";
  if (filtering && !holdsPrivilege(actor, "usersView")) return forbidden(actor);
  const allRoles = filtering && holdsPrivilege(actor, "rolesView");
  if (!allRoles && !holdsAnyPrivilege(actor, filtering ? ["usersCreate", "usersEdit"] : ["rolesDelete", "usersCreate", "usersEdit"])) {
    return forbidden(actor);
  }
  try {
    const policy = toPolicyActor(actor);
    const filter: RoleFilter = {
      q: typeof query.q === "string" ? query.q.trim().slice(0, MANAGEMENT_SEARCH_MAX_LENGTH).trim() : "",
      status: allRoles ? "all" : "active",
      excludeRoleId: isUuid(query.excludeRoleId) ? query.excludeRoleId : null,
    };
    if (!allRoles) {
      // Only live catalog keys outside the current ceiling block a custom role.
      const ceiling = new Set(policy.permissions);
      filter.assignable = {
        allowMaster: policy.isMaster,
        forbiddenKeys: permissionsOfDomain(actor.domain)
          .filter((permission) => !isModuleDisabled(permission.module, policy.disabledModules) && !ceiling.has(permission.key))
          .map((permission) => permission.key),
      };
    }
    const store  = storeFor(actor);
    const total  = await store.countRoles(filter);
    const window = pageWindow(total, parseManagementPage(query.page));
    const roles  = await store.listRoles(filter, window.skip, window.take);
    return { ok: true, data: { rows: roles.map((role) => toRoleOption(policy, role)), total, page: window.page, pageCount: window.pageCount, pageSize: MANAGEMENT_PAGE_SIZE } };
  } catch (error) {
    logFailure(actor, "searching role options", error);
    return { ok: false, reason: "unavailable", error: LOAD_FAILED_MESSAGE };
  }
}

// ---------------------------------------------------------------------------
// Mutations

/**
 * Description: Build the refusal for a policy denial on a role.
 * Input: The denial reason and the role id.
 * Output: A forbidden refusal (audited as an escalation attempt, except for a
 *   disabled replacement role, which is a plain validation problem).
 * Use case: updateRole, setRoleStatus, deleteRole.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function policyRefusal(reason: PolicyDenial, roleId: string): Refusal<RoleFieldErrors> {
  return {
    ok: false,
    reason: "forbidden",
    error: POLICY_DENIAL_MESSAGES[reason],
    escalation: { attempt: reason, targetType: "role", targetId: roleId },
  };
}

/**
 * Description: Build the refusal for a mutation of the actor's own role, decided
 *   before any exclusive lock (reloadActor already share-locks that row).
 * Input: The reloaded actor and the role id (equal to the actor's role id).
 * Output: system_role when the own role is the master role (same answer as
 *   checkRoleManageable, which checks system roles first), else own_role.
 * Use case: updateRole, setRoleStatus, deleteRole.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function ownRoleRefusal(fresh: Pick<PolicyActor, "isMaster">, roleId: string): Refusal<RoleFieldErrors> {
  return policyRefusal(fresh.isMaster ? "system_role" : "own_role", roleId);
}

/**
 * Description: Build the refusal for an invalid privilege selection.
 * Input: The failed privilege request and the role id (null on create).
 * Output: A validation refusal with the message under "permissions"; unknown,
 *   foreign, disabled-module and above-ceiling keys are audited as escalation.
 * Use case: createRole and updateRole.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function privilegeRefusal(
  request: Extract<ReturnType<typeof validatePrivilegeRequest>, { ok: false }>,
  roleId: string | null,
): Refusal<RoleFieldErrors> {
  const refusal: Refusal<RoleFieldErrors> = {
    ok: false,
    reason: "validation",
    error: request.message,
    fieldErrors: { permissions: request.message },
  };
  if (request.escalation) refusal.escalation = { attempt: `privileges_${request.problem}`, targetType: "role", targetId: roleId, keys: request.keys.slice(0, 50) };
  return refusal;
}

/**
 * Description: Create a custom role in the actor's scope.
 * Input: The actor and the submitted form (name, description, status, permissions).
 * Output: ok with the new role id, or field errors (name rules incl. reserved
 *   master names, uniqueness per scope, privileges: empty / unknown / other
 *   domain / disabled module / above the actor's ceiling / missing requires),
 *   forbidden or unavailable. Privileges are checked against the actor's
 *   ceiling read fresh inside the transaction. Audits role.created (keys added)
 *   or authz.escalation_blocked.
 * Use case: Role editor "Save role" (create).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function createRole(actor: AuthzActor, input: RoleInput): Promise<RoleMutationResult> {
  // Step 1: the privilege (snapshot; re-checked inside the transaction).
  if (!holdsPrivilege(actor, "rolesCreate")) return forbidden(actor);

  // Step 2: the text fields (name, description, status).
  const fields = validateRoleFields(input);
  if (!fields.ok) return { ok: false, reason: "validation", error: "Check the highlighted fields.", fieldErrors: fields.fieldErrors };

  try {
    // Step 3: ceiling, privileges, uniqueness and the insert — one transaction.
    const outcome = await storeFor(actor).transaction(async (ops) => {
      const fresh = await ops.reloadActor();
      if (!holdsPrivilege(fresh, "rolesCreate")) return { ...forbidden(fresh) } as Refusal<RoleFieldErrors>;

      const request = validatePrivilegeRequest(fresh, input.permissions, []);
      if (!request.ok) return privilegeRefusal(request, null);

      if (await ops.isRoleNameTaken(fields.value.name, null)) {
        return { ok: false, reason: "conflict", error: MESSAGES.nameTaken, fieldErrors: { name: MESSAGES.nameTaken } } as Refusal<RoleFieldErrors>;
      }
      const roleId = await ops.insertRole({ ...fields.value, permissionKeys: request.finalKeys, createdById: actor.userId });
      return { ok: true as const, roleId, keys: request.finalKeys };
    });
    if (!outcome.ok) return settleRefusal(actor, outcome);

    // Step 4: audit after commit (keys only).
    await auditAfterCommit(actor, {
      action: "role.created",
      targetType: "role",
      targetId: outcome.roleId,
      metadata: { status: fields.value.status, added: outcome.keys, removed: [] },
    });
    console.log(`[rbac] ${actor.domain} role ${outcome.roleId} created by user ${actor.userId}`);
    return { ok: true, roleId: outcome.roleId, message: "Role created.", affectedUserCount: 0 };
  } catch (error) {
    // A concurrent create with the same name lost the race at the unique index.
    if (isUniqueViolation(error)) return { ok: false, reason: "conflict", error: MESSAGES.nameTaken, fieldErrors: { name: MESSAGES.nameTaken } };
    logFailure(actor, "creating a role", error);
    return { ok: false, reason: "unavailable", error: UNAVAILABLE_MESSAGE };
  }
}

/**
 * Description: Update a custom role's name, description, status and privileges.
 * Input: The actor, the role id (untrusted) and the submitted form.
 * Output: ok with the affected user count, or field errors / forbidden (system
 *   role, own role, above the ceiling) / not_found / unavailable. The stored set
 *   = requested keys ∪ the role's keys of currently disabled modules (kept,
 *   never added). Audits role.updated (keys added/removed, changed fields) and
 *   role.disabled / role.enabled when the status changed.
 * Use case: Role editor "Save role" (edit).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function updateRole(actor: AuthzActor, roleId: unknown, input: RoleInput): Promise<RoleMutationResult> {
  // Step 1: privilege and id.
  if (!holdsPrivilege(actor, "rolesEdit")) return forbidden(actor);
  if (!isUuid(roleId)) return { ok: false, reason: "not_found", error: MESSAGES.notFound };

  // Step 2: the text fields.
  const fields = validateRoleFields(input);
  if (!fields.ok) return { ok: false, reason: "validation", error: "Check the highlighted fields.", fieldErrors: fields.fieldErrors };

  try {
    // Step 3: lock, re-validate and write in one transaction.
    const outcome = await storeFor(actor).transaction(async (ops) => {
      const fresh = await ops.reloadActor();
      if (!holdsPrivilege(fresh, "rolesEdit")) return { ...forbidden(fresh) } as Refusal<RoleFieldErrors>;

      // The actor's own role is share-locked by reloadActor: refuse before any exclusive lock.
      if (fresh.roleId === roleId) return ownRoleRefusal(fresh, roleId);

      // The role row is locked until commit: concurrent edits/deletes wait.
      const role = await ops.lockRole(roleId, "update");
      if (!role) return { ok: false, reason: "not_found", error: MESSAGES.notFound } as Refusal<RoleFieldErrors>;
      const decision = checkRoleManageable(fresh, role);
      if (!decision.ok) return policyRefusal(decision.reason, role.id);

      const request = validatePrivilegeRequest(fresh, input.permissions, role.permissionKeys);
      if (!request.ok) return privilegeRefusal(request, role.id);

      if (await ops.isRoleNameTaken(fields.value.name, role.id)) {
        return { ok: false, reason: "conflict", error: MESSAGES.nameTaken, fieldErrors: { name: MESSAGES.nameTaken } } as Refusal<RoleFieldErrors>;
      }
      await ops.updateRole(role.id, fields.value);
      await ops.replaceRolePermissions(role.id, request.finalKeys);
      return { ok: true as const, before: role, finalKeys: request.finalKeys };
    });
    if (!outcome.ok) return settleRefusal(actor, outcome);

    // Step 4: what changed (privilege keys and field names, never values of secrets).
    const { before, finalKeys } = outcome;
    const added   = finalKeys.filter((key) => !before.permissionKeys.includes(key));
    const removed = before.permissionKeys.filter((key) => !finalKeys.includes(key));
    const changed = [
      ...(before.name !== fields.value.name ? ["name"] : []),
      ...(before.description !== fields.value.description ? ["description"] : []),
      ...(before.status !== fields.value.status ? ["status"] : []),
    ];
    const metadata: AuditMetadata = { added, removed, changedFields: changed, affectedUsers: before.userCount };
    await auditAfterCommit(actor, { action: "role.updated", targetType: "role", targetId: before.id, metadata });
    if (before.status !== fields.value.status) {
      await auditAfterCommit(actor, {
        action: fields.value.status === "disabled" ? "role.disabled" : "role.enabled",
        targetType: "role",
        targetId: before.id,
        metadata: { affectedUsers: before.userCount },
      });
    }
    console.log(`[rbac] ${actor.domain} role ${before.id} updated by user ${actor.userId}`);
    return { ok: true, roleId: before.id, message: "Role saved.", affectedUserCount: before.userCount };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "conflict", error: MESSAGES.nameTaken, fieldErrors: { name: MESSAGES.nameTaken } };
    logFailure(actor, `updating role ${roleId}`, error);
    return { ok: false, reason: "unavailable", error: UNAVAILABLE_MESSAGE };
  }
}

/**
 * Description: Disable or enable a custom role.
 * Input: The actor, the role id and the new status ("active" | "disabled"; untrusted).
 * Output: ok with the affected user count (they lose / regain access on their
 *   next request), or forbidden / not_found / conflict (already in that
 *   status) / unavailable. Audits role.disabled / role.enabled.
 * Use case: Disable / Enable confirmations of the roles list and details page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function setRoleStatus(actor: AuthzActor, roleId: unknown, status: unknown): Promise<RoleMutationResult> {
  // Step 1: privilege, id and the new status.
  if (!holdsPrivilege(actor, "rolesEdit")) return forbidden(actor);
  if (!isUuid(roleId)) return { ok: false, reason: "not_found", error: MESSAGES.notFound };
  const next = validateRoleStatus(typeof status === "string" ? status : "");
  if (!next.ok) return { ok: false, reason: "validation", error: next.error, fieldErrors: { status: next.error } };

  try {
    // Step 2: lock, re-validate and write in one transaction.
    const outcome = await storeFor(actor).transaction(async (ops) => {
      const fresh = await ops.reloadActor();
      if (!holdsPrivilege(fresh, "rolesEdit")) return { ...forbidden(fresh) } as Refusal<RoleFieldErrors>;
      // The actor's own role is share-locked by reloadActor: refuse before any exclusive lock.
      if (fresh.roleId === roleId) return ownRoleRefusal(fresh, roleId);
      const role = await ops.lockRole(roleId, "update");
      if (!role) return { ok: false, reason: "not_found", error: MESSAGES.notFound } as Refusal<RoleFieldErrors>;
      const decision = checkRoleManageable(fresh, role);
      if (!decision.ok) return policyRefusal(decision.reason, role.id);
      if (role.status === next.value) return { ok: false, reason: "conflict", error: MESSAGES.sameStatus } as Refusal<RoleFieldErrors>;
      await ops.updateRole(role.id, { name: role.name, description: role.description, status: next.value });
      return { ok: true as const, role };
    });
    if (!outcome.ok) return settleRefusal(actor, outcome);

    // Step 3: audit after commit.
    await auditAfterCommit(actor, {
      action: next.value === "disabled" ? "role.disabled" : "role.enabled",
      targetType: "role",
      targetId: outcome.role.id,
      metadata: { affectedUsers: outcome.role.userCount },
    });
    console.log(`[rbac] ${actor.domain} role ${outcome.role.id} set ${next.value} by user ${actor.userId}`);
    return {
      ok: true,
      roleId: outcome.role.id,
      message: next.value === "disabled" ? "Role disabled." : "Role enabled.",
      affectedUserCount: outcome.role.userCount,
    };
  } catch (error) {
    logFailure(actor, `changing the status of role ${roleId}`, error);
    return { ok: false, reason: "unavailable", error: UNAVAILABLE_MESSAGE };
  }
}

/**
 * Description: Delete a custom role; its holders move to a replacement role first.
 * Input: The actor, the role id and the confirmation (replacement role id,
 *   exactly one, required when users hold the role).
 * Output: ok with the number of reassigned users, or field errors
 *   (replacementRoleId: missing, several, same role, unavailable, not
 *   assignable by the actor), forbidden / not_found / unavailable. Locks the
 *   role, its holders and the replacement; reassigns and deletes in ONE
 *   transaction (any failure leaves everything unchanged). Audits role.deleted,
 *   user.role_changed (one event with the user ids) and master_role.assigned
 *   when the replacement is the master role.
 * Use case: "Delete" / "Delete and reassign" confirmations.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function deleteRole(actor: AuthzActor, roleId: unknown, input: DeleteRoleInput = {}): Promise<RoleMutationResult> {
  // Step 1: privilege and id.
  if (!holdsPrivilege(actor, "rolesDelete")) return forbidden(actor);
  if (!isUuid(roleId)) return { ok: false, reason: "not_found", error: MESSAGES.notFound };

  try {
    // Step 2: everything below in one transaction.
    const outcome = await storeFor(actor).transaction(async (ops) => {
      const fresh = await ops.reloadActor();
      if (!holdsPrivilege(fresh, "rolesDelete")) return { ...forbidden(fresh) } as Refusal<RoleFieldErrors>;

      // Step 2a: the role (locked) must be manageable; the actor's own role (share-locked
      // by reloadActor) is refused before any exclusive lock.
      if (fresh.roleId === roleId) return ownRoleRefusal(fresh, roleId);
      const role = await ops.lockRole(roleId, "update");
      if (!role) return { ok: false, reason: "not_found", error: MESSAGES.notFound } as Refusal<RoleFieldErrors>;
      const decision = checkRoleManageable(fresh, role);
      if (!decision.ok) return policyRefusal(decision.reason, role.id);

      // Step 2b: its holders (locked); with holders a replacement is required — never a silent fallback.
      const holders = await ops.lockRoleHolders(role.id);
      let replacement: StoredRole | null = null;
      let moved: string[] = [];
      if (holders.length > 0) {
        const parsed = parseSingleRoleId(input.replacementRoleId);
        if (!parsed.ok) {
          const message = parsed.error === SINGLE_ROLE_MESSAGES.multiple ? parsed.error : MESSAGES.replacementRequired;
          return { ok: false, reason: "validation", error: message, fieldErrors: { replacementRoleId: message } } as Refusal<RoleFieldErrors>;
        }
        if (parsed.roleId === role.id) {
          return { ok: false, reason: "validation", error: MESSAGES.replacementSame, fieldErrors: { replacementRoleId: MESSAGES.replacementSame } } as Refusal<RoleFieldErrors>;
        }
        // Shared lock: the replacement cannot be deleted or disabled before we commit.
        replacement = await ops.lockRole(parsed.roleId, "share");
        if (!replacement) {
          return { ok: false, reason: "validation", error: MESSAGES.replacementMissing, fieldErrors: { replacementRoleId: MESSAGES.replacementMissing } } as Refusal<RoleFieldErrors>;
        }
        const assignable = checkRoleAssignable(fresh, replacement);
        if (!assignable.ok) {
          const message = POLICY_DENIAL_MESSAGES[assignable.reason];
          const refusal: Refusal<RoleFieldErrors> = { ok: false, reason: "validation", error: message, fieldErrors: { replacementRoleId: message } };
          if (assignable.reason !== "inactive_role") refusal.escalation = { attempt: assignable.reason, targetType: "role", targetId: replacement.id };
          return refusal;
        }
        moved = await ops.reassignRoleHolders(role.id, replacement.id);
      }

      // Step 2c: the delete itself (RESTRICT guarantees nobody holds it any more).
      await ops.deleteRole(role.id);
      return { ok: true as const, role, replacement, moved };
    });
    if (!outcome.ok) return settleRefusal(actor, outcome);

    // Step 3: audit after commit.
    const { role, replacement, moved } = outcome;
    await auditAfterCommit(actor, {
      action: "role.deleted",
      targetType: "role",
      targetId: role.id,
      metadata: { removed: [...role.permissionKeys], reassignedTo: replacement?.id ?? null, reassignedUsers: moved.length },
    });
    if (replacement && moved.length > 0) {
      await auditAfterCommit(actor, {
        action: "user.role_changed",
        targetType: "role",
        targetId: replacement.id,
        metadata: { fromRoleId: role.id, toRoleId: replacement.id, userIds: moved },
      });
      if (isMasterRole(replacement)) {
        await auditAfterCommit(actor, { action: "master_role.assigned", targetType: "role", targetId: replacement.id, metadata: { userIds: moved } });
      }
    }
    console.log(`[rbac] ${actor.domain} role ${role.id} deleted by user ${actor.userId} (${moved.length} users reassigned)`);
    const message = moved.length > 0 && replacement ? `Role deleted. ${moved.length} user(s) now hold "${replacement.name}".` : "Role deleted.";
    return { ok: true, roleId: role.id, message, affectedUserCount: moved.length };
  } catch (error) {
    logFailure(actor, `deleting role ${roleId}`, error);
    return { ok: false, reason: "unavailable", error: UNAVAILABLE_MESSAGE };
  }
}

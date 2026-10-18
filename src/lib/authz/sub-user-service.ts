import "server-only";
/**
 * Sub-user management of the three panels: Sub-Platform Owners, Sub-Tenants
 * (staff users) and Sub-Customers (customer row + its login user)
 * (.vibe/memory/role-privilege-management.md, "Business rules" → "Single
 * role", "Master roles and primary accounts", "Sub-users", "Account lifecycle").
 *
 * ONE implementation for all domains (storage per domain through
 * stores/index.ts). Every mutation:
 *   1. checks the management privilege (defence in depth);
 *   2. validates the form with the SAME rules as the client
 *      (sub-user-rules.ts) and reads exactly ONE role id (parseSingleRoleId);
 *   3. inside ONE transaction: re-reads the actor's ceiling, locks the target
 *      user and the role, checks manageable / assignable (policy.ts) and the
 *      email / username uniqueness (workspace: under the registration flow's
 *      advisory lock, pending and rejected registrations included);
 *   4. audits after commit; returns friendly messages only. Passwords and
 *      hashes are never logged, audited or returned.
 */
import type { AuditMetadata } from "@/lib/audit";
import { hashPassword } from "@/lib/platform-auth/password";
import { validateEmail, validateFullName, validateTenantUsername } from "@/lib/tenants/rules";
import { isUuid } from "@/lib/uuid";
import { identityConflictErrors, type IdentityConflicts } from "@/lib/workspace/identity";
import { textOf, validateAccountType, type AccountType } from "@/lib/workspace/rules";
import { toPolicyActor, type AuthzActor } from "./actor";
import {
  auditAfterCommit,
  forbidden,
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
  SUB_USER_COUNT_CATEGORIES,
  type ManagementPage,
  type QueryResult,
  type SubUserCountRecords,
  type SubUserEditModel,
  type SubUserListQuery,
  type SubUserMutationResult,
  type SubUserRow,
  type SubUserSummary,
} from "./management-model";
import {
  checkRoleAssignable,
  checkUserManageable,
  isMasterRole,
  parseSingleRoleId,
  POLICY_DENIAL_MESSAGES,
  type PolicyActor,
  type PolicyDenial,
} from "./policy";
import { listAssignableRoles } from "./role-service";
import { storeFor, type StoredUser } from "./stores";
import { validateSubUserFields, type SubUserFieldErrors, type SubUserFields } from "./sub-user-rules";

/** The submitted create form (untrusted values straight from FormData). */
export type SubUserCreateInput = {
  fullName: unknown;
  /** Sub-customers only. */
  accountType?: unknown;
  username: unknown;
  /** Sub-Tenants and Sub-Customers only. */
  email?: unknown;
  password: unknown;
  confirmPassword: unknown;
  /** Usually FormData.getAll("roleId"): exactly one entry is accepted. */
  roleId: unknown;
};

/**
 * The submitted edit form (untrusted). Business rule "Edit: full name, role,
 * optional new password": any other submitted field (email, username, account
 * type, …) is ignored, so a crafted request cannot change it.
 */
export type SubUserUpdateInput = {
  fullName: unknown;
  /** Usually FormData.getAll("roleId"): exactly one entry is accepted. */
  roleId: unknown;
  /** Optional "Set a new password" (both empty = keep the password). */
  password?: unknown;
  confirmPassword?: unknown;
};

// Friendly messages of this service.
const MESSAGES = {
  notFound: "This account no longer exists. Refresh the page.",
  roleNotFound: "The chosen role is not available. Choose another role.",
  alreadySuspended: "This account is already suspended. Refresh the page.",
  alreadyActive: "This account is already active. Refresh the page.",
  checkFields: "Check the highlighted fields.",
  identityRace: "This username or email address was just taken. Choose another one.",
} as const;

// ---------------------------------------------------------------------------
// Shaping and small helpers

/**
 * Description: Describe a stored user to the policy.
 * Input: The stored user (read inside the actor's team scope).
 * Output: The PolicyUser (in scope, primary flag, current role).
 * Use case: Every manageable check of this service.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function policyUserOf(user: StoredUser) {
  return { id: user.id, isPrimary: user.isPrimary, inScope: true, role: user.role };
}

/**
 * Description: Turn a stored user into a sub-user list row for this actor.
 * Input: The policy actor and the stored user.
 * Output: The row with the role, the "You" flag and the manageable flag.
 * Use case: listSubUsers and listSubUserCountRecords.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function toRow(actor: PolicyActor, user: StoredUser): SubUserRow {
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    roleId: user.role?.id ?? null,
    roleName: user.role?.name ?? null,
    roleIsMaster: user.role ? isMasterRole(user.role) : false,
    accountType: user.accountType,
    status: user.status,
    isPrimary: user.isPrimary,
    isSelf: user.id === actor.userId,
    manageable: checkUserManageable(actor, policyUserOf(user)).ok,
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * Description: Turn taken identities into field errors.
 * Input: The conflicts found by the store.
 * Output: One message per taken field (empty when nothing is taken).
 * Use case: createSubUser and updateSubUser. The texts are shared with the
 *   tenant's customer creation (identityConflictErrors in src/lib/workspace/identity.ts).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-17
 */
function identityErrors(conflicts: IdentityConflicts): SubUserFieldErrors {
  return identityConflictErrors(conflicts);
}

/**
 * Description: Build the refusal for a policy denial on a user or a role.
 * Input: The denial, the target type ("user" / "role") and its id.
 * Output: A forbidden refusal (role problems go under the role field);
 *   audited as an escalation attempt except for a disabled role.
 * Use case: createSubUser, updateSubUser, setSubUserStatus.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function policyRefusal(reason: PolicyDenial, targetType: "user" | "role", targetId: string): Refusal<SubUserFieldErrors> {
  const message = POLICY_DENIAL_MESSAGES[reason];
  const refusal: Refusal<SubUserFieldErrors> = {
    ok: false,
    reason: targetType === "role" ? "validation" : "forbidden",
    error: message,
  };
  if (targetType === "role") refusal.fieldErrors = { roleId: message };
  if (reason !== "inactive_role") refusal.escalation = { attempt: reason, targetType, targetId };
  return refusal;
}

/**
 * Description: Read one page of the actor's team.
 * Input: The actor and the list query (search, status, role filter, page).
 * Output: The page of sub-user rows.
 * Use case: listSubUsers and listSubUserCountRecords.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
async function teamPage(actor: AuthzActor, query: SubUserListQuery): Promise<ManagementPage<SubUserRow>> {
  const store  = storeFor(actor);
  const policy = toPolicyActor(actor);
  const filter = { audience: "team" as const, q: query.q, status: query.status, roleId: query.roleId };
  const total  = await store.countUsers(filter);
  const window = pageWindow(total, query.page);
  const users  = await store.listUsers(filter, window.skip, window.take);
  return { rows: users.map((user) => toRow(policy, user)), total, page: window.page, pageCount: window.pageCount, pageSize: MANAGEMENT_PAGE_SIZE };
}

// ---------------------------------------------------------------------------
// Queries

/**
 * Description: List one page of the actor's sub-users.
 * Input: The actor and the query (search on name/username/email, status, role filter, page).
 * Output: The rows (newest first), total and page count; or forbidden / unavailable.
 *   Platform: every platform owner; tenant: every staff user; customer: the
 *   sub-customers of the actor's main customer.
 * Use case: /platform/users, /tenant/users, /customer/sub-customers (needs the users view privilege).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function listSubUsers(actor: AuthzActor, query: SubUserListQuery): Promise<QueryResult<ManagementPage<SubUserRow>>> {
  if (!holdsPrivilege(actor, "usersView")) return forbidden(actor);
  try {
    return { ok: true, data: await teamPage(actor, query) };
  } catch (error) {
    logFailure(actor, "listing sub-users", error);
    return { ok: false, reason: "unavailable", error: LOAD_FAILED_MESSAGE };
  }
}

/**
 * Description: Count the actor's sub-users for the summary cards.
 * Input: The actor.
 * Output: Total, active and suspended (same conditions as the list filters).
 * Use case: Sub-user page summary (each figure opens listSubUserCountRecords).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function getSubUserSummary(actor: AuthzActor): Promise<QueryResult<SubUserSummary>> {
  if (!holdsPrivilege(actor, "usersView")) return forbidden(actor);
  try {
    const store     = storeFor(actor);
    const total     = await store.countUsers({ audience: "team" });
    const active    = await store.countUsers({ audience: "team", status: "active" });
    const suspended = await store.countUsers({ audience: "team", status: "suspended" });
    return { ok: true, data: { total, active, suspended } };
  } catch (error) {
    logFailure(actor, "counting sub-users", error);
    return { ok: false, reason: "unavailable", error: LOAD_FAILED_MESSAGE };
  }
}

/**
 * Description: List the exact records behind one sub-user summary figure.
 * Input: The actor, the category (total / active / suspended; untrusted) and the page.
 * Output: The page of rows plus the calculation text.
 * Use case: CountDetails popups of the sub-user pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function listSubUserCountRecords(
  actor: AuthzActor,
  category: unknown,
  page: unknown,
): Promise<QueryResult<SubUserCountRecords>> {
  if (!holdsPrivilege(actor, "usersView")) return forbidden(actor);
  const known = SUB_USER_COUNT_CATEGORIES.find((candidate) => candidate === category);
  if (!known) return { ok: false, reason: "validation", error: "Choose a figure to explain." };
  try {
    const status = known === "total" ? "all" : known;
    const rows   = await teamPage(actor, { q: "", status, roleId: null, page: parseManagementPage(page) });
    const calculation =
      known === "total"
        ? `Every account in this list, active and suspended: ${rows.total}.`
        : known === "active"
          ? `Accounts that can sign in now: ${rows.total}.`
          : `Accounts that are suspended and cannot sign in: ${rows.total}.`;
    return { ok: true, data: { category: known, calculation, page: rows } };
  } catch (error) {
    logFailure(actor, "listing sub-user count records", error);
    return { ok: false, reason: "unavailable", error: LOAD_FAILED_MESSAGE };
  }
}

/**
 * Description: Build the prefilled edit form of one sub-user.
 * Input: The actor and the user id (untrusted).
 * Output: The current values (never a password or hash), the manageable flag
 *   with its reason, and the roles this actor may assign; not_found outside the scope.
 * Use case: /<panel>/users/[id]/edit and /customer/sub-customers/[id]/edit.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function getSubUserEditModel(actor: AuthzActor, userId: unknown): Promise<QueryResult<SubUserEditModel>> {
  if (!holdsPrivilege(actor, "usersEdit")) return forbidden(actor);
  if (!isUuid(userId)) return { ok: false, reason: "not_found", error: MESSAGES.notFound };
  try {
    // Step 1: the user inside the team scope.
    const user = await storeFor(actor).findUser(userId);
    if (!user) return { ok: false, reason: "not_found", error: MESSAGES.notFound };

    // Step 2: the policy decision and the role picker options.
    const decision = checkUserManageable(toPolicyActor(actor), policyUserOf(user));
    const roles    = await listAssignableRoles(actor, { selectedRoleId: user.role?.id });
    if (!roles.ok) return roles;
    return {
      ok: true,
      data: {
        user: {
          id: user.id,
          fullName: user.fullName,
          username: user.username,
          email: user.email,
          accountType: user.accountType,
          roleId: user.role?.id ?? null,
          roleName: user.role?.name ?? null,
          status: user.status,
          isPrimary: user.isPrimary,
        },
        manageable: decision.ok,
        manageableReason: decision.ok ? null : decision.reason,
        assignableRoles: roles.data,
      },
    };
  } catch (error) {
    logFailure(actor, "building the sub-user edit form", error);
    return { ok: false, reason: "unavailable", error: LOAD_FAILED_MESSAGE };
  }
}

// ---------------------------------------------------------------------------
// Mutations

/**
 * Description: Create a sub-user with exactly one role.
 * Input: The actor and the submitted form. Platform: full name, username,
 *   password + confirmation, role. Tenant: plus email. Customer: plus email
 *   and account type (a customer row under the actor's MAIN customer is
 *   created with its login user — never under a sub-customer).
 * Output: ok with the new user id, or field errors (form rules, exactly one
 *   role id, taken username/email incl. pending/rejected registrations, role
 *   not found / disabled / above the ceiling / master without being master),
 *   forbidden or unavailable. Audits user.created and master_role.assigned.
 * Use case: "Create sub-platform owner" / "Create sub-tenant" / "Create sub-customer".
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function createSubUser(actor: AuthzActor, input: SubUserCreateInput): Promise<SubUserMutationResult> {
  // Step 1: the privilege (snapshot; re-checked inside the transaction).
  if (!holdsPrivilege(actor, "usersCreate")) return forbidden(actor);

  // Step 2: exactly one role id, then every field with the form's own rules.
  const role   = parseSingleRoleId(input.roleId);
  const fields: SubUserFields = {
    fullName: textOf(input.fullName),
    accountType: textOf(input.accountType),
    username: textOf(input.username),
    email: textOf(input.email),
    password: textOf(input.password),
    confirmPassword: textOf(input.confirmPassword),
    roleId: role.ok ? role.roleId : "",
  };
  const fieldErrors = validateSubUserFields(fields, actor.domain, "create");
  if (!role.ok) fieldErrors.roleId = role.error;
  if (Object.keys(fieldErrors).length > 0) return { ok: false, reason: "validation", error: MESSAGES.checkFields, fieldErrors };

  // Step 3: the normalized values (the rules above already passed).
  const fullName    = validateFullName(fields.fullName);
  const username    = validateTenantUsername(fields.username);
  const email       = actor.domain === "platform" ? null : validateEmail(fields.email);
  const accountType = actor.domain === "customer" ? validateAccountType(fields.accountType) : null;
  if (!fullName.ok || !username.ok || !role.ok || (email && !email.ok) || (accountType && !accountType.ok)) {
    return { ok: false, reason: "validation", error: MESSAGES.checkFields };
  }
  const emailValue: string | null             = email && email.ok ? email.value : null;
  const accountTypeValue: AccountType | null  = accountType && accountType.ok ? accountType.value : null;

  try {
    // Step 4: hash outside the transaction (Argon2 is deliberately slow; no locks held).
    const passwordHash = await hashPassword(fields.password);

    // Step 5: ceiling, identities, role and the inserts — one transaction.
    const outcome = await storeFor(actor).transaction(async (ops) => {
      const fresh = await ops.reloadActor();
      if (!holdsPrivilege(fresh, "usersCreate")) return { ...forbidden(fresh) } as Refusal<SubUserFieldErrors>;

      // Step 5a: identities (workspace: the registration flow's advisory lock).
      await ops.lockIdentities();
      const conflicts = await ops.findIdentityConflicts({ username: username.value, ...(emailValue ? { email: emailValue } : {}) }, null);
      const taken     = identityErrors(conflicts);
      if (Object.keys(taken).length > 0) {
        return { ok: false, reason: "conflict", error: MESSAGES.checkFields, fieldErrors: taken } as Refusal<SubUserFieldErrors>;
      }

      // Step 5b: the role, share-locked, must be assignable by this actor.
      const assigned = await ops.lockRole(role.roleId, "share");
      if (!assigned) {
        return { ok: false, reason: "validation", error: MESSAGES.roleNotFound, fieldErrors: { roleId: MESSAGES.roleNotFound } } as Refusal<SubUserFieldErrors>;
      }
      const decision = checkRoleAssignable(fresh, assigned);
      if (!decision.ok) return policyRefusal(decision.reason, "role", assigned.id);

      // Step 5c: the account (and, for a sub-customer, its customer row) with its single role.
      const userId = await ops.insertUser({
        fullName: fullName.value,
        username: username.value,
        email: emailValue,
        passwordHash,
        accountType: accountTypeValue,
        roleId: assigned.id,
        createdById: actor.userId,
      });
      return { ok: true as const, userId, role: assigned };
    });
    if (!outcome.ok) return settleRefusal(actor, outcome);

    // Step 6: audit after commit (ids and the role only; never the password).
    const metadata: AuditMetadata = { roleId: outcome.role.id, ...(accountTypeValue ? { accountType: accountTypeValue } : {}) };
    await auditAfterCommit(actor, { action: "user.created", targetType: "user", targetId: outcome.userId, metadata });
    if (isMasterRole(outcome.role)) {
      await auditAfterCommit(actor, { action: "master_role.assigned", targetType: "user", targetId: outcome.userId, metadata: { roleId: outcome.role.id } });
    }
    console.log(`[rbac] ${actor.domain} sub-user ${outcome.userId} created by user ${actor.userId}`);
    return { ok: true, userId: outcome.userId, message: "Account created." };
  } catch (error) {
    // A concurrent claim lost the race at a unique index.
    if (isUniqueViolation(error)) {
      const raced: SubUserFieldErrors = { username: MESSAGES.identityRace };
      if (actor.domain !== "platform") raced.email = MESSAGES.identityRace;
      return { ok: false, reason: "conflict", error: MESSAGES.identityRace, fieldErrors: raced };
    }
    logFailure(actor, "creating a sub-user", error);
    return { ok: false, reason: "unavailable", error: UNAVAILABLE_MESSAGE };
  }
}

/**
 * Description: Update a sub-user: full name, the single role and an optional
 *   new password (nothing else; email, username and account type stay fixed).
 * Input: The actor, the user id (untrusted) and the submitted form.
 * Output: ok, or field errors / forbidden (self, primary, master holder while
 *   not master, role above the ceiling) / not_found / unavailable. A new
 *   password is hashed and ends every session of that user. Audits
 *   user.updated, user.role_changed, master_role.assigned, user.password_reset.
 * Use case: Sub-user edit forms.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function updateSubUser(actor: AuthzActor, userId: unknown, input: SubUserUpdateInput): Promise<SubUserMutationResult> {
  // Step 1: privilege and id.
  if (!holdsPrivilege(actor, "usersEdit")) return forbidden(actor);
  if (!isUuid(userId)) return { ok: false, reason: "not_found", error: MESSAGES.notFound };

  try {
    // Step 2: the current account (its username is part of the password rule).
    const current = await storeFor(actor).findUser(userId);
    if (!current) return { ok: false, reason: "not_found", error: MESSAGES.notFound };

    // Step 3: the form's own rules (edit mode: full name, optional password pair, role).
    const role   = parseSingleRoleId(input.roleId);
    const fields: SubUserFields = {
      fullName: textOf(input.fullName),
      accountType: "",
      username: current.username ?? "",
      email: "",
      password: textOf(input.password),
      confirmPassword: textOf(input.confirmPassword),
      roleId: role.ok ? role.roleId : "",
    };
    const fieldErrors = validateSubUserFields(fields, actor.domain, "edit", current.username ?? "");
    if (!role.ok) fieldErrors.roleId = role.error;
    if (Object.keys(fieldErrors).length > 0 || !role.ok) {
      return { ok: false, reason: "validation", error: MESSAGES.checkFields, fieldErrors };
    }
    const fullName = validateFullName(fields.fullName);
    if (!fullName.ok) return { ok: false, reason: "validation", error: MESSAGES.checkFields, fieldErrors: { fullName: fullName.error } };

    // Step 4: hash a new password outside the transaction.
    const passwordHash = fields.password !== "" ? await hashPassword(fields.password) : null;

    // Step 5: lock, re-validate and write in one transaction.
    const outcome = await storeFor(actor).transaction(async (ops) => {
      const fresh = await ops.reloadActor();
      if (!holdsPrivilege(fresh, "usersEdit")) return { ...forbidden(fresh) } as Refusal<SubUserFieldErrors>;

      // Step 5a: the target (locked) must be manageable by this actor.
      // The actor's own row is share-locked by reloadActor: refuse before the exclusive lock.
      if (userId === fresh.userId) return policyRefusal("self", "user", userId);
      const target = await ops.lockUser(userId);
      if (!target) return { ok: false, reason: "not_found", error: MESSAGES.notFound } as Refusal<SubUserFieldErrors>;
      const manageable = checkUserManageable(fresh, policyUserOf(target));
      if (!manageable.ok) return policyRefusal(manageable.reason, "user", target.id);

      // Step 5b: a different role must be assignable (share-locked until commit).
      const roleChanged = target.role?.id !== role.roleId;
      let nextRole      = target.role;
      if (roleChanged) {
        const assigned = await ops.lockRole(role.roleId, "share");
        if (!assigned) {
          return { ok: false, reason: "validation", error: MESSAGES.roleNotFound, fieldErrors: { roleId: MESSAGES.roleNotFound } } as Refusal<SubUserFieldErrors>;
        }
        const decision = checkRoleAssignable(fresh, assigned);
        if (!decision.ok) return policyRefusal(decision.reason, "role", assigned.id);
        nextRole = assigned;
      }

      // Step 5c: the writes (full name, role, password — nothing else).
      const changedFields = fullName.value !== target.fullName ? ["fullName"] : [];
      await ops.updateUser(target.id, { fullName: fullName.value });
      if (roleChanged && nextRole) await ops.assignRole(target.id, nextRole.id);
      if (passwordHash) await ops.setPassword(target.id, passwordHash);
      return { ok: true as const, target, nextRole, roleChanged, changedFields };
    });
    if (!outcome.ok) return settleRefusal(actor, outcome);

    // Step 6: audit after commit (field names and role ids only).
    const { target, nextRole, roleChanged, changedFields } = outcome;
    if (changedFields.length > 0) {
      await auditAfterCommit(actor, { action: "user.updated", targetType: "user", targetId: target.id, metadata: { changedFields } });
    }
    if (roleChanged && nextRole) {
      await auditAfterCommit(actor, {
        action: "user.role_changed",
        targetType: "user",
        targetId: target.id,
        metadata: { fromRoleId: target.role?.id ?? null, toRoleId: nextRole.id },
      });
      if (isMasterRole(nextRole)) {
        await auditAfterCommit(actor, { action: "master_role.assigned", targetType: "user", targetId: target.id, metadata: { roleId: nextRole.id } });
      }
    }
    if (passwordHash) await auditAfterCommit(actor, { action: "user.password_reset", targetType: "user", targetId: target.id });
    console.log(`[rbac] ${actor.domain} sub-user ${target.id} updated by user ${actor.userId}`);
    return { ok: true, userId: target.id, message: "Account saved." };
  } catch (error) {
    logFailure(actor, `updating sub-user ${String(userId)}`, error);
    return { ok: false, reason: "unavailable", error: UNAVAILABLE_MESSAGE };
  }
}

/**
 * Description: Suspend or reactivate a sub-user.
 * Input: The actor, the user id and the change ("suspend" | "reactivate"; untrusted).
 * Output: ok, or forbidden (self, primary, above the ceiling, master holder) /
 *   not_found / conflict (already in that state) / unavailable. Platform owner
 *   and staff user: the account status; sub-customer: its customer row. A
 *   suspension deletes the sessions at once. Audits user.suspended / user.reactivated.
 * Use case: Suspend / Reactivate confirmations of the sub-user lists.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function setSubUserStatus(actor: AuthzActor, userId: unknown, change: unknown): Promise<SubUserMutationResult> {
  // Step 1: privilege, id and the change.
  if (!holdsPrivilege(actor, "usersSuspend")) return forbidden(actor);
  if (!isUuid(userId)) return { ok: false, reason: "not_found", error: MESSAGES.notFound };
  if (change !== "suspend" && change !== "reactivate") return { ok: false, reason: "validation", error: "Choose suspend or reactivate." };

  try {
    // Step 2: lock, re-validate and write in one transaction.
    const outcome = await storeFor(actor).transaction(async (ops) => {
      const fresh = await ops.reloadActor();
      if (!holdsPrivilege(fresh, "usersSuspend")) return { ...forbidden(fresh) } as Refusal<SubUserFieldErrors>;
      // The actor's own row is share-locked by reloadActor: refuse before the exclusive lock.
      if (userId === fresh.userId) return policyRefusal("self", "user", userId);
      const target = await ops.lockUser(userId);
      if (!target) return { ok: false, reason: "not_found", error: MESSAGES.notFound } as Refusal<SubUserFieldErrors>;
      const manageable = checkUserManageable(fresh, policyUserOf(target));
      if (!manageable.ok) return policyRefusal(manageable.reason, "user", target.id);
      if (!(await ops.setUserStatus(target.id, change))) {
        const message = change === "suspend" ? MESSAGES.alreadySuspended : MESSAGES.alreadyActive;
        return { ok: false, reason: "conflict", error: message } as Refusal<SubUserFieldErrors>;
      }
      return { ok: true as const, target };
    });
    if (!outcome.ok) return settleRefusal(actor, outcome);

    // Step 3: audit after commit.
    await auditAfterCommit(actor, {
      action: change === "suspend" ? "user.suspended" : "user.reactivated",
      targetType: "user",
      targetId: outcome.target.id,
      ...(outcome.target.customerId ? { metadata: { customerId: outcome.target.customerId } } : {}),
    });
    console.log(`[rbac] ${actor.domain} sub-user ${outcome.target.id} ${change === "suspend" ? "suspended" : "reactivated"} by user ${actor.userId}`);
    return { ok: true, userId: outcome.target.id, message: change === "suspend" ? "Account suspended." : "Account reactivated." };
  } catch (error) {
    logFailure(actor, `changing the status of sub-user ${String(userId)}`, error);
    return { ok: false, reason: "unavailable", error: UNAVAILABLE_MESSAGE };
  }
}

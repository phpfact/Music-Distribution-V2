/**
 * Shared, client-safe model of role and sub-user management
 * (.vibe/memory/role-privilege-management.md, "Technical Notes" → "Services").
 *
 * The data shapes the services return to pages / Server Actions, the list
 * query parsing (URL search parameters), and which catalog privilege guards
 * which operation in each domain. Pure: no `server-only`, no `node:` imports,
 * no database — client components may import the same types.
 */
import type { AuthzDomain, DomainPermissionKey } from "./catalog";
import type { PolicyDenial, PrivilegeLockReason, RoleFieldErrors } from "./policy";
import type { SubUserFieldErrors } from "./sub-user-rules";
import { isUuid } from "@/lib/uuid";

// ---------------------------------------------------------------------------
// Which privilege guards which operation, per domain

/** The management privileges of one domain. */
export type ManagementPrivileges<D extends AuthzDomain> = {
  rolesView: DomainPermissionKey<D>;
  rolesCreate: DomainPermissionKey<D>;
  rolesEdit: DomainPermissionKey<D>;
  rolesDelete: DomainPermissionKey<D>;
  usersView: DomainPermissionKey<D>;
  usersCreate: DomainPermissionKey<D>;
  usersEdit: DomainPermissionKey<D>;
  usersSuspend: DomainPermissionKey<D>;
};

/** The catalog keys of roles and sub-user management in each domain. */
export const MANAGEMENT_PRIVILEGES: { [D in AuthzDomain]: ManagementPrivileges<D> } = {
  platform: {
    rolesView: "platform.roles.view",
    rolesCreate: "platform.roles.create",
    rolesEdit: "platform.roles.edit",
    rolesDelete: "platform.roles.delete",
    usersView: "platform.users.view",
    usersCreate: "platform.users.create",
    usersEdit: "platform.users.edit",
    usersSuspend: "platform.users.suspend",
  },
  tenant: {
    rolesView: "tenant.roles.view",
    rolesCreate: "tenant.roles.create",
    rolesEdit: "tenant.roles.edit",
    rolesDelete: "tenant.roles.delete",
    usersView: "tenant.users.view",
    usersCreate: "tenant.users.create",
    usersEdit: "tenant.users.edit",
    usersSuspend: "tenant.users.suspend",
  },
  customer: {
    rolesView: "customer.roles.view",
    rolesCreate: "customer.roles.create",
    rolesEdit: "customer.roles.edit",
    rolesDelete: "customer.roles.delete",
    usersView: "customer.sub_customers.view",
    usersCreate: "customer.sub_customers.create",
    usersEdit: "customer.sub_customers.edit",
    usersSuspend: "customer.sub_customers.suspend",
  },
};

/** One management operation (a key of ManagementPrivileges). */
export type ManagementOperation = keyof ManagementPrivileges<AuthzDomain>;

// ---------------------------------------------------------------------------
// Lists: page size and URL query parsing

export const MANAGEMENT_PAGE_SIZE         = 20;
export const MANAGEMENT_MAX_PAGE          = 10_000;
export const MANAGEMENT_SEARCH_MAX_LENGTH = 100;

/** Role list status filter. */
export type RoleStatusFilter = "all" | "active" | "disabled";
export const ROLE_STATUS_FILTERS: readonly { value: RoleStatusFilter; label: string }[] = [
  { value: "all",      label: "All statuses" },
  { value: "active",   label: "Active" },
  { value: "disabled", label: "Disabled" },
];

/** Sub-user list status filter. */
export type SubUserStatusFilter = "all" | "active" | "suspended";
export const SUB_USER_STATUS_FILTERS: readonly { value: SubUserStatusFilter; label: string }[] = [
  { value: "all",       label: "All statuses" },
  { value: "active",    label: "Active" },
  { value: "suspended", label: "Suspended" },
];

export type RoleListQuery    = { q: string; status: RoleStatusFilter; page: number };
export type SubUserListQuery = { q: string; status: SubUserStatusFilter; roleId: string | null; page: number };

/**
 * Description: Read one search parameter that may appear once, several times or not at all.
 * Input: The value Next.js gives for the parameter.
 * Output: The first value, or "" when missing.
 * Use case: parseRoleListQuery, parseSubUserListQuery.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * Description: Read a page number from a search parameter or an action argument.
 * Input: Any value (string from the URL or number from a Server Action).
 * Output: A positive integer within bounds, otherwise 1.
 * Use case: The list queries and the count-details popups.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function parseManagementPage(value: unknown): number {
  const page =
    typeof value === "number" ? value : typeof value === "string" && /^[0-9]{1,5}$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(page) && page >= 1 && page <= MANAGEMENT_MAX_PAGE ? page : 1;
}

/**
 * Description: Read a search text from a search parameter.
 * Input: The raw value.
 * Output: Trimmed and capped at 100 characters (never a huge pattern for the database).
 * Use case: parseRoleListQuery, parseSubUserListQuery.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function searchText(value: string | string[] | undefined): string {
  return firstValue(value).trim().slice(0, MANAGEMENT_SEARCH_MAX_LENGTH).trim();
}

/**
 * Description: Read the role list's search, status and page from the URL.
 * Input: The page's search parameters (anyone can edit them).
 * Output: A valid query; bad values fall back to the defaults (never fails).
 * Use case: /platform/roles, /tenant/roles, /customer/roles.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function parseRoleListQuery(searchParams: Record<string, string | string[] | undefined>): RoleListQuery {
  const statusText = firstValue(searchParams.status);
  const status     = ROLE_STATUS_FILTERS.find((filter) => filter.value === statusText)?.value ?? "all";
  return { q: searchText(searchParams.q), status, page: parseManagementPage(firstValue(searchParams.page)) };
}

/**
 * Description: Read the sub-user list's search, status, role filter and page from the URL.
 * Input: The page's search parameters (anyone can edit them).
 * Output: A valid query; a malformed role id is ignored (no filter).
 * Use case: /platform/users, /tenant/users, /customer/sub-customers.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function parseSubUserListQuery(searchParams: Record<string, string | string[] | undefined>): SubUserListQuery {
  const statusText = firstValue(searchParams.status);
  const status     = SUB_USER_STATUS_FILTERS.find((filter) => filter.value === statusText)?.value ?? "all";
  const roleText   = firstValue(searchParams.role).trim().toLowerCase();
  return {
    q: searchText(searchParams.q),
    status,
    roleId: isUuid(roleText) ? roleText : null,
    page: parseManagementPage(firstValue(searchParams.page)),
  };
}

// ---------------------------------------------------------------------------
// Generic results

/** One page of rows. */
export type ManagementPage<Row> = { rows: Row[]; total: number; page: number; pageCount: number; pageSize: number };

/** Why a query or mutation was refused. */
export type ManagementProblem = "validation" | "forbidden" | "not_found" | "conflict" | "unavailable";

/** A query result: the data, or a friendly error. */
export type QueryResult<T> = { ok: true; data: T } | { ok: false; reason: ManagementProblem; error: string };

// ---------------------------------------------------------------------------
// Roles

/** A role in the role list (and the count popups). */
export type RoleListRow = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "disabled";
  /** Master (system) role: "System" badge, never mutable. */
  isMaster: boolean;
  /** Effective privilege count (null for a master role = "All (N)"; see allPrivilegeCount). */
  privilegeCount: number | null;
  /** The role's effective privilege keys (master: the whole domain), disabled modules excluded. */
  privilegeKeys: string[];
  /** Users of the actor's scope holding the role. */
  userCount: number;
  /** The actor may edit/disable/delete it (also needs the matching privilege). */
  manageable: boolean;
  createdAt: string;
  updatedAt: string;
};

/** The role list page plus the domain's total privilege count ("All (N)"). */
export type RoleListPage = ManagementPage<RoleListRow> & { allPrivilegeCount: number };

/** The four summary figures of the roles page. */
export type RoleSummary = { total: number; active: number; disabled: number; usersAssigned: number };

/** Which summary figure a count popup explains. */
export type RoleCountCategory = "total" | "active" | "disabled" | "users_assigned";
export const ROLE_COUNT_CATEGORIES: readonly RoleCountCategory[] = ["total", "active", "disabled", "users_assigned"];

/** A user holding a role (role details, "Users assigned" popup). Raw values: the UI masks them. */
export type AssignedUserRow = {
  id: string;
  fullName: string;
  /** Mask in the UI (eye toggle). */
  username: string | null;
  /** Mask in the UI (eye toggle); null for platform owners. */
  email: string | null;
  status: "active" | "suspended";
  isPrimary: boolean;
  roleId: string | null;
  roleName: string | null;
};

/** The records behind one summary figure (with the calculation to show). */
export type RoleCountRecords =
  | { kind: "roles"; category: Exclude<RoleCountCategory, "users_assigned">; calculation: string; page: ManagementPage<RoleListRow> }
  | { kind: "users"; category: "users_assigned"; calculation: string; page: ManagementPage<AssignedUserRow> };

/** One granted privilege in the role details. */
export type RoleDetailsPrivilege = { key: string; label: string; description: string };

/** One module group of the role details (only modules with granted privileges). */
export type RoleDetailsModule = {
  key: string;
  label: string;
  /** Switched off centrally: these privileges are inert ("Module disabled by the Platform Owner"). */
  disabled: boolean;
  privileges: RoleDetailsPrivilege[];
};

/** Everything the role details page shows. */
export type RoleDetails = {
  role: {
    id: string;
    name: string;
    description: string | null;
    status: "active" | "disabled";
    isMaster: boolean;
    privilegeCount: number | null;
    createdAt: string;
    updatedAt: string;
  };
  modules: RoleDetailsModule[];
  /** First page of the users holding it (more via listRoleUsers). */
  assignedUsers: ManagementPage<AssignedUserRow>;
  /** Users who lose/gain access when the role changes. */
  affectedUserCount: number;
  manageable: boolean;
  /** Why it is not manageable (null when manageable). */
  manageableReason: PolicyDenial | null;
};

/** One privilege in the role editor. */
export type RoleEditorPrivilege = {
  key: string;
  label: string;
  description: string;
  requires: string[];
  /** A checkbox (true) or a locked "Not assignable" entry (false). */
  assignable: boolean;
  lockedReason: PrivilegeLockReason | null;
};

/** One module card of the role editor. */
export type RoleEditorModule = {
  key: string;
  label: string;
  description: string;
  core: boolean;
  disabled: boolean;
  privileges: RoleEditorPrivilege[];
};

/** Everything the role editor (create / edit) needs. */
export type RoleEditorModel = {
  mode: "create" | "edit";
  roleId: string | null;
  modules: RoleEditorModule[];
  initial: { name: string; description: string; status: "active" | "disabled"; permissionKeys: string[] };
  /** Stored keys of disabled modules: kept unchanged on save, never shown as checkboxes. */
  preservedKeys: string[];
  affectedUserCount: number;
};

/** A role offered by a picker (sub-user form, replacement on delete). */
export type AssignableRoleOption = {
  id: string;
  name: string;
  isMaster: boolean;
  /** Effective privilege count; null = all privileges (master). */
  privilegeCount: number | null;
};

/** A role mutation result (friendly messages only). */
export type RoleMutationResult =
  | { ok: true; roleId: string; message: string; affectedUserCount: number }
  | { ok: false; reason: ManagementProblem; error: string; fieldErrors?: RoleFieldErrors };

// ---------------------------------------------------------------------------
// Sub-users

/** A sub-user in the list (and the count popups). Raw values: the UI masks username/email. */
export type SubUserRow = {
  id: string;
  fullName: string;
  username: string | null;
  /** null for platform owners. */
  email: string | null;
  roleId: string | null;
  roleName: string | null;
  roleIsMaster: boolean;
  /** Sub-customers only. */
  accountType: "artist" | "label" | "white_label" | null;
  status: "active" | "suspended";
  isPrimary: boolean;
  isSelf: boolean;
  /** The actor may edit/suspend it (also needs the matching privilege). */
  manageable: boolean;
  createdAt: string;
};

/** The three summary figures of a sub-user page. */
export type SubUserSummary = { total: number; active: number; suspended: number };

/** Which summary figure a count popup explains. */
export type SubUserCountCategory = "total" | "active" | "suspended";
export const SUB_USER_COUNT_CATEGORIES: readonly SubUserCountCategory[] = ["total", "active", "suspended"];

/** The records behind one sub-user summary figure. */
export type SubUserCountRecords = { category: SubUserCountCategory; calculation: string; page: ManagementPage<SubUserRow> };

/** The prefilled edit form (never a password or hash). */
export type SubUserEditModel = {
  user: {
    id: string;
    fullName: string;
    username: string | null;
    email: string | null;
    accountType: "artist" | "label" | "white_label" | null;
    roleId: string | null;
    roleName: string | null;
    status: "active" | "suspended";
    isPrimary: boolean;
  };
  manageable: boolean;
  manageableReason: PolicyDenial | null;
  /** Active roles this actor may assign (the current role is included when still assignable). */
  assignableRoles: AssignableRoleOption[];
};

/** A sub-user mutation result (friendly messages only). */
export type SubUserMutationResult =
  | { ok: true; userId: string; message: string }
  | { ok: false; reason: ManagementProblem; error: string; fieldErrors?: SubUserFieldErrors };

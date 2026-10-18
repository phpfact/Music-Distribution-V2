/**
 * Serializable view types of the shared RBAC screens
 * (.vibe/memory/role-privilege-management.md, "UI specs (approved 2026-10-16)").
 *
 * Pages (Platform, Tenant, Customer) build these plain objects on the server
 * and pass them to the components in src/components/rbac/, together with their
 * own bound Server Actions. Everything here crosses the server → client
 * boundary, so only strings, numbers, booleans, null and arrays are used
 * (dates as ISO strings).
 */
import type { SubUserFieldName } from "@/lib/authz/sub-user-rules";

/** One privilege the role editor or a read-only list shows. */
export type PrivilegeView = {
  /** Stable catalog key, e.g. "tenant.users.edit". */
  key: string;
  label: string;
  description: string;
  /** Keys this privilege needs (ticking it ticks them; shown as "needs View"). */
  requires: string[];
};

/** One module (group of privileges). */
export type ModuleView = {
  key: string;
  label: string;
  description: string;
  privileges: PrivilegeView[];
};

/** Why a privilege cannot be granted by the current actor. */
export type LockedReason = "outside_privileges" | "module_disabled";

/** A privilege the actor may NOT grant: shown in the locked group, never as a checkbox. */
export type LockedPrivilegeView = {
  key: string;
  label: string;
  moduleLabel: string;
  reason: LockedReason;
};

/** A read-only privilege in a details list (marks module-disabled ones). */
export type ReadOnlyPrivilegeView = PrivilegeView & {
  /** True when the Platform Owner switched the privilege's module off. */
  moduleDisabled?: boolean;
};

/** A module in a read-only privilege list. */
export type ReadOnlyModuleView = {
  key: string;
  label: string;
  description: string;
  privileges: ReadOnlyPrivilegeView[];
};

/** Role status as stored. */
export type RoleStatusValue = "active" | "disabled";

/** One row of the roles directory. */
export type RoleRowView = {
  id: string;
  name: string;
  description: string | null;
  status: RoleStatusValue;
  /** A master (system) role: never editable, grants every privilege. */
  isMaster: boolean;
  /** Whether the current actor may edit/disable/delete it (delegation ceiling). */
  manageable: boolean;
  /** Number of privileges; null = all (master roles). */
  privilegeCount: number | null;
  userCount: number;
  /** ISO date-time. */
  updatedAt: string;
};

/** One choice of the role picker (only active roles the actor may assign). */
export type RoleOptionView = {
  id: string;
  name: string;
  isMaster: boolean;
  /** Number of privileges; null = all (master roles). */
  privilegeCount: number | null;
};

/** User account status as stored. */
export type UserStatusValue = "active" | "disabled";

/**
 * The change a Suspend / Reactivate button asks for, computed from the status
 * the row shows (the services refuse a change to the state the account already
 * has, so a stale page never flips it back).
 */
export type UserStatusChange = "suspend" | "reactivate";

/** A user holding a role (role details, disable/delete dialogs, count popups). */
export type AssignedUserView = {
  id: string;
  fullName: string;
  /** Null when the panel has no such field. */
  username: string | null;
  /** Null for platform owners (they have no email). */
  email: string | null;
  status: UserStatusValue;
};

/** Customer account categories (sub-customers only). */
export type AccountTypeValue = "artist" | "label" | "white_label";

/** One row of a sub-users directory. */
export type SubUserRowView = {
  id: string;
  fullName: string;
  username: string | null;
  email: string | null;
  roleName: string;
  roleIsMaster: boolean;
  status: UserStatusValue;
  /** The panel's primary account (lockout protection: never managed here). */
  isPrimary: boolean;
  /** The signed-in user themself. */
  isSelf: boolean;
  /** Whether the current actor may edit/suspend this user. */
  manageable: boolean;
  /** Sub-customers only. */
  accountType?: AccountTypeValue;
  /** ISO date-time. */
  createdAt: string;
};

/** One server page of a directory (server-side pagination). */
export type PageView<Row> = {
  rows: Row[];
  /** 1-based page number. */
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};

/** The role editor's field names (FormData keys). */
export type RoleFieldName = "name" | "description" | "status" | "privileges";

/**
 * Result of the role create/edit Server Action (useActionState state).
 * idle: nothing submitted yet; error: field errors under each field and/or a
 * form-level message. On success the action redirects, so there is no
 * success state.
 */
export type RoleFormState =
  | { status: "idle" }
  | {
      status: "error";
      fieldErrors: Partial<Record<RoleFieldName, string>>;
      formMessage?: string;
    };

/**
 * Result of the sub-user create/edit Server Action (useActionState state).
 * The form keeps every typed value except passwords after an error.
 */
export type SubUserFormState =
  | { status: "idle" }
  | {
      status: "error";
      fieldErrors: Partial<Record<SubUserFieldName, string>>;
      formMessage?: string;
    };

/** Result of a one-shot RBAC action (disable, enable, delete, suspend, …). */
export type RbacActionResult = { ok: true; message: string } | { ok: false; error: string };

/** Result of loading the records behind a count (count-details popups). */
export type RecordsResult<Row> = { ok: true; page: PageView<Row> } | { ok: false; error: string };

/** Scoped role search action shared by assignment pickers and directory filters. */
export type LoadRoleOptions = (search: string, page: number, excludeRoleId?: string) => Promise<RecordsResult<RoleOptionView>>;
/** The role-operation purpose selects the exact current privilege on the server. */
export type RoleOptionsPurpose = "create" | "edit" | "delete" | "filter";

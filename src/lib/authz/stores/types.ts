/**
 * The storage contract shared by the three authorization domains
 * (.vibe/memory/role-privilege-management.md, "Technical Notes" → "Services").
 *
 * The role and sub-user services hold ONE implementation of every business
 * rule; only the storage differs per domain:
 *   - platform  → control plane (platform_roles, platform_owners)   stores/platform.ts
 *   - tenant    → tenant database (roles domain 'tenant', staff users)  stores/workspace.ts
 *   - customer  → tenant database (roles domain 'customer' of one main
 *                 customer + Master Customer, sub-customers)            stores/workspace.ts
 *
 * Every store is bound to ONE actor's scope when it is created
 * (stores/index.ts), so a query can never leave that scope: ids of another
 * tenant, another main customer or another domain simply are not found.
 */
import type { IdentityConflicts } from "@/lib/workspace/identity";
import type { AccountType } from "@/lib/workspace/rules";
import type { AuthzDomain } from "../catalog";
import type { RoleStatusFilter, SubUserStatusFilter } from "../management-model";
import type { PolicyActor, PolicyRole } from "../policy";

/** A role as read from storage (inside the store's scope). */
export type StoredRole = PolicyRole & {
  name: string;
  description: string | null;
  /** Users of the store's scope holding this role (customer: the main customer's tree only). */
  userCount: number;
  createdAt: Date;
  updatedAt: Date;
};

/** A user as read from storage (never a password hash). */
export type StoredUser = {
  id: string;
  fullName: string;
  username: string | null;
  /** null for platform owners (they have no email). */
  email: string | null;
  /** suspended = account disabled (sub-customers: user or its customer disabled). */
  status: "active" | "suspended";
  isPrimary: boolean;
  createdAt: Date;
  /** Sub-customers only: the customer row and its account type. */
  customerId: string | null;
  accountType: AccountType | null;
  /** The user's single role, or null. */
  role: (PolicyRole & { name: string }) | null;
};

/**
 * Which users a query covers:
 *   team         — the sub-user page: all platform owners / staff users /
 *                  sub-customers of the main customer;
 *   role_holders — everyone whose role counts in this scope: platform owners /
 *                  staff users / the main customer's tree (main + subs).
 */
export type UserAudience = "team" | "role_holders";

/** Role list filters (database level). */
export type RoleFilter = { q?: string; status?: RoleStatusFilter };

/** User list filters (database level). */
export type UserFilter = {
  audience: UserAudience;
  q?: string;
  status?: SubUserStatusFilter;
  /** Only holders of this role. */
  roleId?: string | null;
  /** Only users that hold some role. */
  assignedOnly?: boolean;
};

/** A new custom role. */
export type NewRole = {
  name: string;
  description: string | null;
  status: "active" | "disabled";
  permissionKeys: readonly string[];
  createdById: string;
};

/** The editable columns of a custom role. */
export type RoleChanges = { name: string; description: string | null; status: "active" | "disabled" };

/** A new sub-user (platform owner, staff user, or sub-customer + its user). */
export type NewUser = {
  fullName: string;
  username: string;
  /** Workspace only. */
  email: string | null;
  passwordHash: string;
  /** Sub-customers only. */
  accountType: AccountType | null;
  roleId: string;
  createdById: string;
};

/**
 * The editable details of a sub-user. Business rule "Edit: full name, role,
 * optional new password": email, username and account type never change here.
 */
export type UserChanges = { fullName: string };

/** The fresh actor read inside a transaction (ceiling + primary flag). */
export type ReloadedActor = PolicyActor & { isPrimary: boolean };

/** The writes and locked reads of one transaction (bound to the store's scope). */
export interface AuthzTxOps {
  /**
   * FIRST call of every mutation: share-lock the actor's own row(s) and current
   * role row (fixed order, before any target lock), then re-read the actor's role
   * and privileges under those locks (empty when no longer active).
   */
  reloadActor(): Promise<ReloadedActor>;

  // Roles
  /** Lock a role row (update = exclusive, share = assignment) and read it inside the scope; null when not found. */
  lockRole(roleId: string, mode: "update" | "share"): Promise<StoredRole | null>;
  /** True when another role of the scope already has this name (case-insensitive, like the unique index). */
  isRoleNameTaken(name: string, excludeRoleId: string | null): Promise<boolean>;
  /** Insert a custom role with exactly these privileges; returns its id. */
  insertRole(role: NewRole): Promise<string>;
  /** Update a custom role's name, description and status. */
  updateRole(roleId: string, changes: RoleChanges): Promise<void>;
  /** Replace a role's stored privileges with exactly these keys. */
  replaceRolePermissions(roleId: string, keys: readonly string[]): Promise<void>;
  /** Lock the users holding a role; returns their ids (sorted). */
  lockRoleHolders(roleId: string): Promise<string[]>;
  /** Move every holder of one role to another; returns the moved user ids. */
  reassignRoleHolders(fromRoleId: string, toRoleId: string): Promise<string[]>;
  /** Delete a custom role (its privilege links go with it). */
  deleteRole(roleId: string): Promise<void>;

  // Users
  /** Lock a user row and read it inside the team scope; null when not found. */
  lockUser(userId: string): Promise<StoredUser | null>;
  /** Serialize identity claims (workspace: the registration advisory lock; platform: no-op). */
  lockIdentities(): Promise<void>;
  /** Which of username / email is already claimed (excluding one user on edit). */
  findIdentityConflicts(identity: { username?: string; email?: string }, excludeUserId: string | null): Promise<IdentityConflicts>;
  /** Insert a sub-user with its single role; returns the user id. */
  insertUser(user: NewUser): Promise<string>;
  /** Update a sub-user's details. */
  updateUser(userId: string, changes: UserChanges): Promise<void>;
  /** Give a user exactly this one role (replaces the old one). */
  assignRole(userId: string, roleId: string): Promise<void>;
  /** Store a new password hash and end every session of that user. */
  setPassword(userId: string, passwordHash: string): Promise<void>;
  /** Suspend / reactivate (conditional); suspend ends sessions. False when already in that state. */
  setUserStatus(userId: string, change: "suspend" | "reactivate"): Promise<boolean>;
}

/** The reads of one scope plus its transactions. */
export interface AuthzStore {
  readonly domain: AuthzDomain;
  /** Run dependent writes in ONE transaction (all or nothing). */
  transaction<T>(work: (ops: AuthzTxOps) => Promise<T>): Promise<T>;
  /** One page of roles (master roles first, then name, then id). */
  listRoles(filter: RoleFilter, skip: number, take: number): Promise<StoredRole[]>;
  countRoles(filter: RoleFilter): Promise<number>;
  findRole(roleId: string): Promise<StoredRole | null>;
  /** One page of users (newest first, then id). */
  listUsers(filter: UserFilter, skip: number, take: number): Promise<StoredUser[]>;
  countUsers(filter: UserFilter): Promise<number>;
  /** A user of the team scope. */
  findUser(userId: string): Promise<StoredUser | null>;
}

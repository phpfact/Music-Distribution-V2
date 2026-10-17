import "server-only";
/**
 * Storage of the TENANT and CUSTOMER domains: roles, staff users and
 * sub-customers in ONE tenant database
 * (.vibe/memory/role-privilege-management.md, "Database").
 *
 * Implements the shared AuthzStore contract (./types.ts). The store is bound
 * to the actor's tenant database (taken from the Host-resolved workspace) and,
 * for the customer domain, to the actor's MAIN customer:
 *   - tenant roles:    roles.domain = 'tenant';
 *   - customer roles:  roles.domain = 'customer' AND (Master Customer OR
 *                      owner_customer_id = main customer);
 *   - tenant team:     staff users (customer_id IS NULL);
 *   - customer team:   users of the main customer's sub-customers;
 *   - customer role holders: users of the main customer's tree (main + subs).
 * A row outside these conditions is simply "not found". The database triggers
 * (user_roles_scope_guard, roles_scope_guard, customers_hierarchy_guard)
 * enforce the same rules a second time.
 */
import type { Prisma } from "@/generated/prisma/tenant/client";
import type { TenantDb } from "@/lib/db/tenant";
import { findIdentityConflicts, lockWorkspaceIdentities, type IdentityConflicts } from "@/lib/workspace/identity";
import type { WorkspaceRole } from "@/lib/workspace/sessions";
import type { CustomerAuthzActor, TenantAuthzActor } from "../actor";
import { MASTER_SYSTEM_KEYS } from "../catalog";
import { resolveWorkspaceAccess } from "../workspace-access";
import type {
  AuthzStore,
  AuthzTxOps,
  NewRole,
  NewUser,
  ReloadedActor,
  RoleChanges,
  RoleFilter,
  StoredRole,
  StoredUser,
  UserAudience,
  UserChanges,
  UserFilter,
} from "./types";

/** A tenant or customer actor (both live in a tenant database). */
type WorkspaceActor = TenantAuthzActor | CustomerAuthzActor;

// The role columns every role read needs (without the holder count).
const ROLE_CORE_SELECT = {
  id: true,
  name: true,
  domain: true,
  status: true,
  systemKey: true,
  ownerCustomerId: true,
  permissions: { select: { permission: { select: { key: true } } } },
} as const satisfies Prisma.RoleSelect;

// The user columns every user read needs (never the password hash).
const USER_SELECT = {
  id: true,
  name: true,
  username: true,
  email: true,
  status: true,
  isPrimary: true,
  createdAt: true,
  customerId: true,
  customer: { select: { type: true, status: true } },
  roleAssignment: { select: { role: { select: ROLE_CORE_SELECT } } },
} as const satisfies Prisma.UserSelect;

type SelectedRoleCore = Prisma.RoleGetPayload<{ select: typeof ROLE_CORE_SELECT }>;
type SelectedUser     = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

/**
 * Description: Build the condition that keeps role reads inside the actor's scope.
 * Input: The actor.
 * Output: tenant → tenant-domain roles; customer → Master Customer plus the
 *   custom roles owned by the actor's main customer.
 * Use case: Every role read and lock of this store.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function roleScopeWhere(actor: WorkspaceActor): Prisma.RoleWhereInput {
  if (actor.scope.kind === "tenant") return { domain: "tenant" };
  return {
    domain: "customer",
    OR: [{ systemKey: MASTER_SYSTEM_KEYS.customer }, { ownerCustomerId: actor.scope.mainCustomerId }],
  };
}

/**
 * Description: Build the condition that keeps user reads inside the actor's scope.
 * Input: The actor and the audience (team = sub-user page; role_holders = whole scope).
 * Output: tenant → staff users; customer team → users of the main customer's
 *   sub-customers; customer role holders → users of the main customer's tree.
 * Use case: Every user read and lock; the holder counts of roles.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function userScopeWhere(actor: WorkspaceActor, audience: UserAudience): Prisma.UserWhereInput {
  if (actor.scope.kind === "tenant") return { customerId: null };
  const main = actor.scope.mainCustomerId;
  if (audience === "team") return { customer: { is: { parentId: main } } };
  return { customer: { is: { OR: [{ id: main }, { parentId: main }] } } };
}

/**
 * Description: Turn a selected role into the shared policy role shape plus its name.
 * Input: The selected role columns.
 * Output: The role with its stored privilege keys.
 * Use case: toStoredRole and toStoredUser.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function toRoleCore(row: SelectedRoleCore): NonNullable<StoredUser["role"]> {
  return {
    id: row.id,
    domain: row.domain,
    systemKey: row.systemKey,
    status: row.status,
    ownerCustomerId: row.ownerCustomerId,
    permissionKeys: row.permissions.map((link) => link.permission.key),
    name: row.name,
  };
}

/**
 * Description: Turn a selected user into the shared StoredUser shape.
 * Input: The selected row.
 * Output: The StoredUser; a sub-customer counts as suspended when its user or
 *   its customer row is disabled.
 * Use case: Every user read of this store.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function toStoredUser(row: SelectedUser): StoredUser {
  const customerActive = !row.customer || row.customer.status === "active";
  return {
    id: row.id,
    fullName: row.name,
    username: row.username,
    email: row.email,
    status: row.status === "active" && customerActive ? "active" : "suspended",
    isPrimary: row.isPrimary,
    createdAt: row.createdAt,
    customerId: row.customerId,
    accountType: row.customer?.type ?? null,
    role: row.roleAssignment ? toRoleCore(row.roleAssignment.role) : null,
  };
}

/**
 * Description: Build the database filter of a role list inside the scope.
 * Input: The actor and the filter (search on name/description, status).
 * Output: The Prisma where-condition.
 * Use case: listRoles and countRoles.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function roleWhere(actor: WorkspaceActor, filter: RoleFilter): Prisma.RoleWhereInput {
  const and: Prisma.RoleWhereInput[] = [roleScopeWhere(actor)];
  if (filter.q) {
    and.push({
      OR: [
        { name: { contains: filter.q, mode: "insensitive" } },
        { description: { contains: filter.q, mode: "insensitive" } },
      ],
    });
  }
  if (filter.status && filter.status !== "all") and.push({ status: filter.status });
  return { AND: and };
}

/**
 * Description: Build the database filter of a user list inside the scope.
 * Input: The actor and the filter (audience, search, status, role, assigned only).
 * Output: The Prisma where-condition. Sub-customer status also looks at the
 *   customer row (suspending a sub-customer disables its customer row).
 * Use case: listUsers and countUsers.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function userWhere(actor: WorkspaceActor, filter: UserFilter): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [userScopeWhere(actor, filter.audience)];
  // Search: name (any case), username and email (stored lower-case).
  if (filter.q) {
    const lower = filter.q.toLowerCase();
    and.push({
      OR: [
        { name: { contains: filter.q, mode: "insensitive" } },
        { username: { contains: lower } },
        { email: { contains: lower } },
      ],
    });
  }
  // Status: active needs an active user AND (for customers) an active customer row.
  const isCustomer = actor.scope.kind === "customer";
  if (filter.status === "active") {
    and.push(isCustomer ? { status: "active", customer: { is: { status: "active" } } } : { status: "active" });
  }
  if (filter.status === "suspended") {
    and.push(
      isCustomer ? { OR: [{ status: { not: "active" } }, { customer: { is: { status: { not: "active" } } } }] } : { status: { not: "active" } },
    );
  }
  if (filter.roleId) and.push({ roleAssignment: { is: { roleId: filter.roleId } } });
  if (filter.assignedOnly) and.push({ roleAssignment: { isNot: null } });
  return { AND: and };
}

/**
 * Description: Read roles with the holder count of the actor's scope.
 * Input: The client or transaction, the actor and the Prisma arguments.
 * Output: StoredRole rows (customer: holders counted inside the main customer's tree only).
 * Use case: listRoles, findRole and lockRole.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
async function readRoles(
  db: Pick<Prisma.TransactionClient, "role">,
  actor: WorkspaceActor,
  args: { where: Prisma.RoleWhereInput; orderBy?: Prisma.RoleOrderByWithRelationInput[]; skip?: number; take?: number },
): Promise<StoredRole[]> {
  const rows = await db.role.findMany({
    ...args,
    select: {
      ...ROLE_CORE_SELECT,
      description: true,
      createdAt: true,
      updatedAt: true,
      // Only holders inside the scope: Master Customer is shared by every main customer.
      _count: { select: { users: { where: { user: userScopeWhere(actor, "role_holders") } } } },
    },
  });
  return rows.map((row) => ({
    ...toRoleCore(row),
    description: row.description,
    userCount: row._count.users,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

/**
 * Description: Map catalog keys to the tenant database's permission ids.
 * Input: The transaction, the domain and the keys.
 * Output: The permission ids; throws when a key has no mirror row (catalog and
 *   migration out of step — nothing is written then).
 * Use case: insertRole and replaceRolePermissions.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
async function permissionIdsOf(
  tx: Prisma.TransactionClient,
  domain: "tenant" | "customer",
  keys: readonly string[],
): Promise<string[]> {
  if (keys.length === 0) return [];
  const rows = await tx.permission.findMany({ where: { domain, key: { in: [...keys] } }, select: { id: true } });
  if (rows.length !== new Set(keys).size) throw new Error("a privilege of the catalog is missing from the permissions mirror");
  return rows.map((row) => row.id);
}

/**
 * Description: Build the transaction operations of the workspace store.
 * Input: The interactive tenant-database transaction and the actor.
 * Output: The AuthzTxOps bound to this transaction and scope.
 * Use case: createWorkspaceStore().transaction.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function workspaceTxOps(tx: Prisma.TransactionClient, actor: WorkspaceActor): AuthzTxOps {
  const domain = actor.domain;
  return {
    async reloadActor(): Promise<ReloadedActor> {
      // Step 0: share-lock, in this fixed order and before any target lock: the
      // actor's user row, its customer rows (own + main), its user_roles row and
      // its role row. A concurrent reassignment (user_roles upsert), an edit of the
      // actor's role (role row FOR UPDATE), a suspension of the actor or of its
      // customer now serializes with this transaction — never a stale ceiling.
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${actor.userId}::uuid FOR SHARE`;
      if (actor.scope.kind === "customer") {
        await tx.$queryRaw`
          SELECT "id" FROM "customers"
          WHERE "id" IN (${actor.scope.customerId}::uuid, ${actor.scope.mainCustomerId}::uuid)
          ORDER BY "id" FOR SHARE`;
      }
      const link = await tx.$queryRaw<{ roleId: string }[]>`
        SELECT "role_id"::text AS "roleId" FROM "user_roles" WHERE "user_id" = ${actor.userId}::uuid FOR SHARE`;
      const lockedRoleId = link[0]?.roleId ?? null;
      if (lockedRoleId) await tx.$queryRaw`SELECT "id" FROM "roles" WHERE "id" = ${lockedRoleId}::uuid FOR SHARE`;

      // Step 1: the actor's account, customer and role, read fresh under those locks.
      const user = await tx.user.findUnique({
        where: { id: actor.userId },
        select: {
          status: true,
          isPrimary: true,
          customer: { select: { id: true, type: true, name: true, parentId: true, status: true, parent: { select: { status: true } } } },
          roleAssignment: { select: { role: { select: ROLE_CORE_SELECT } } },
        },
      });

      // Step 2: the account must still be usable in the actor's area (else: empty ceiling).
      const customer = user?.customer ?? null;
      const usable =
        user?.status === "active" &&
        (actor.scope.kind === "tenant"
          ? customer === null
          : customer !== null &&
            customer.id === actor.scope.customerId &&
            customer.status === "active" &&
            (customer.parent === null || customer.parent.status === "active"));

      // Step 3: the same decision the guards make (src/lib/authz/workspace-access.ts).
      const assigned = user?.roleAssignment?.role ?? null;
      const role: WorkspaceRole | null = assigned
        ? { ...toRoleCore(assigned), domain: assigned.domain, permissionKeys: assigned.permissions.map((link) => link.permission.key) }
        : null;
      const access = resolveWorkspaceAccess(
        { role, customer: customer ? { id: customer.id, type: customer.type, name: customer.name, parentId: customer.parentId } : null },
        domain,
        actor.disabledModules,
      );
      return {
        domain,
        userId: actor.userId,
        roleId: access.roleId,
        isMaster: usable && access.isMaster,
        isPrimary: user?.isPrimary === true,
        permissions: usable ? [...access.permissions] : [],
        disabledModules: actor.disabledModules,
        mainCustomerId: actor.scope.kind === "customer" ? actor.scope.mainCustomerId : null,
      };
    },

    async lockRole(roleId, mode): Promise<StoredRole | null> {
      // Lock first, then read the committed row inside the scope.
      if (mode === "update") await tx.$queryRaw`SELECT "id" FROM "roles" WHERE "id" = ${roleId}::uuid FOR UPDATE`;
      else await tx.$queryRaw`SELECT "id" FROM "roles" WHERE "id" = ${roleId}::uuid FOR SHARE`;
      const rows = await readRoles(tx, actor, { where: { AND: [{ id: roleId }, roleScopeWhere(actor)] } });
      return rows[0] ?? null;
    },

    async isRoleNameTaken(name, excludeRoleId): Promise<boolean> {
      // Same comparison as the unique index roles_scope_name_key:
      // (domain, COALESCE(owner, zero uuid), lower(name)).
      const owner = actor.scope.kind === "customer" ? actor.scope.mainCustomerId : null;
      const rows  = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id"::text AS "id" FROM "roles"
        WHERE "domain" = ${domain}::authz_domain
          AND COALESCE("owner_customer_id", '00000000-0000-0000-0000-000000000000'::uuid)
            = COALESCE(${owner}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
          AND lower("name") = lower(${name})
          AND (${excludeRoleId}::uuid IS NULL OR "id" <> ${excludeRoleId}::uuid)
        LIMIT 1`;
      return rows.length > 0;
    },

    async insertRole(role: NewRole): Promise<string> {
      // Step 1: the mirror ids of the privileges.
      const permissionIds = await permissionIdsOf(tx, domain, role.permissionKeys);
      // Step 2: the role (custom customer roles belong to the MAIN customer) with its links.
      const created = await tx.role.create({
        data: {
          name: role.name,
          description: role.description,
          status: role.status,
          domain,
          ownerCustomerId: actor.scope.kind === "customer" ? actor.scope.mainCustomerId : null,
          createdById: role.createdById,
          permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
        },
        select: { id: true },
      });
      return created.id;
    },

    async updateRole(roleId: string, changes: RoleChanges): Promise<void> {
      await tx.role.update({
        where: { id: roleId },
        data: { name: changes.name, description: changes.description, status: changes.status },
      });
    },

    async replaceRolePermissions(roleId, keys): Promise<void> {
      // Exactly the given keys afterwards: remove all, then insert the new set.
      const permissionIds = await permissionIdsOf(tx, domain, keys);
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (permissionIds.length > 0) {
        await tx.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId, permissionId })) });
      }
    },

    async lockRoleHolders(roleId): Promise<string[]> {
      // Sorted, so two transactions lock the same rows in the same order.
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "user_id"::text AS "id" FROM "user_roles" WHERE "role_id" = ${roleId}::uuid ORDER BY "user_id" FOR UPDATE`;
      return rows.map((row) => row.id);
    },

    async reassignRoleHolders(fromRoleId, toRoleId): Promise<string[]> {
      // Step 1: who holds the role now (already locked by lockRoleHolders).
      const holders = await tx.userRole.findMany({ where: { roleId: fromRoleId }, select: { userId: true }, orderBy: { userId: "asc" } });
      // Step 2: one update moves them all (user_id is the key: one role per user).
      await tx.userRole.updateMany({ where: { roleId: fromRoleId }, data: { roleId: toRoleId } });
      return holders.map((holder) => holder.userId);
    },

    async deleteRole(roleId): Promise<void> {
      // RESTRICT on user_roles.role_id: fails if anybody still holds it.
      await tx.role.delete({ where: { id: roleId } });
    },

    async lockUser(userId): Promise<StoredUser | null> {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      const row = await tx.user.findFirst({ where: { AND: [{ id: userId }, userScopeWhere(actor, "team")] }, select: USER_SELECT });
      return row ? toStoredUser(row) : null;
    },

    async lockIdentities(): Promise<void> {
      // The same advisory lock as sign-up and approval (src/lib/workspace/identity.ts).
      await lockWorkspaceIdentities(tx);
    },

    async findIdentityConflicts(identity, excludeUserId): Promise<IdentityConflicts> {
      return findIdentityConflicts(tx, identity, excludeUserId);
    },

    async insertUser(user: NewUser): Promise<string> {
      // Step 1 (customer): the sub-customer row, always under the MAIN customer (one level deep).
      let customerId: string | null = null;
      if (actor.scope.kind === "customer") {
        if (!user.accountType) throw new Error("a sub-customer needs an account type");
        const customer = await tx.customer.create({
          data: { type: user.accountType, name: user.fullName, status: "active", parentId: actor.scope.mainCustomerId },
          select: { id: true },
        });
        customerId = customer.id;
      }
      // Step 2: the login user with its single role (user_roles keyed on user_id).
      const created = await tx.user.create({
        data: {
          email: user.email ?? "",
          username: user.username,
          passwordHash: user.passwordHash,
          name: user.fullName,
          status: "active",
          customerId,
          // Sub-users are never primary accounts.
          isPrimary: false,
          roleAssignment: { create: { roleId: user.roleId } },
        },
        select: { id: true },
      });
      return created.id;
    },

    async updateUser(userId: string, changes: UserChanges): Promise<void> {
      // Step 1: the full name (email, username and account type never change here).
      await tx.user.update({ where: { id: userId }, data: { name: changes.fullName } });

      // Step 2 (customer): the sub-customer row mirrors the full name.
      if (actor.scope.kind !== "customer") return;
      const owner = await tx.user.findUnique({ where: { id: userId }, select: { customerId: true } });
      if (owner?.customerId) {
        await tx.customer.updateMany({ where: { id: owner.customerId, parentId: actor.scope.mainCustomerId }, data: { name: changes.fullName } });
      }
    },

    async assignRole(userId, roleId): Promise<void> {
      // Upsert on user_id: one role per user, the old one is replaced (never merged).
      await tx.userRole.upsert({ where: { userId }, create: { userId, roleId }, update: { roleId } });
    },

    async setPassword(userId, passwordHash): Promise<void> {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      // A new password ends every open session of that user.
      await tx.userSession.deleteMany({ where: { userId } });
    },

    async setUserStatus(userId, change): Promise<boolean> {
      const from = change === "suspend" ? "active" : "disabled";
      const to   = change === "suspend" ? "disabled" : "active";

      // Sub-customer: the customer row carries the status; every user of it loses its sessions.
      if (actor.scope.kind === "customer") {
        const owner = await tx.user.findUnique({ where: { id: userId }, select: { customerId: true } });
        if (!owner?.customerId) return false;
        const updated = await tx.customer.updateMany({
          where: { id: owner.customerId, parentId: actor.scope.mainCustomerId, status: from },
          data: { status: to },
        });
        if (updated.count === 1 && change === "suspend") {
          await tx.userSession.deleteMany({ where: { user: { customerId: owner.customerId } } });
        }
        return updated.count === 1;
      }

      // Staff user: the user row carries the status.
      const updated = await tx.user.updateMany({ where: { id: userId, customerId: null, status: from }, data: { status: to } });
      if (updated.count === 1 && change === "suspend") await tx.userSession.deleteMany({ where: { userId } });
      return updated.count === 1;
    },
  };
}

/**
 * Description: Create the workspace store (tenant or customer domain) for one actor.
 * Input: The tenant database (from the actor's Host-resolved workspace) and the actor.
 * Output: The AuthzStore bound to that database and scope.
 * Use case: storeFor(actor) (stores/index.ts).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function createWorkspaceStore(db: TenantDb, actor: WorkspaceActor): AuthzStore {
  return {
    domain: actor.domain,

    transaction<T>(work: (ops: AuthzTxOps) => Promise<T>): Promise<T> {
      return db.$transaction((tx) => work(workspaceTxOps(tx, actor)));
    },

    async listRoles(filter, skip, take): Promise<StoredRole[]> {
      return readRoles(db, actor, {
        where: roleWhere(actor, filter),
        // Master role first (system key set), then by name; id keeps the order deterministic.
        orderBy: [{ systemKey: { sort: "asc", nulls: "last" } }, { name: "asc" }, { id: "asc" }],
        skip,
        take,
      });
    },

    async countRoles(filter): Promise<number> {
      return db.role.count({ where: roleWhere(actor, filter) });
    },

    async findRole(roleId): Promise<StoredRole | null> {
      const rows = await readRoles(db, actor, { where: { AND: [{ id: roleId }, roleScopeWhere(actor)] } });
      return rows[0] ?? null;
    },

    async listUsers(filter, skip, take): Promise<StoredUser[]> {
      const rows = await db.user.findMany({
        where: userWhere(actor, filter),
        select: USER_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
      });
      return rows.map(toStoredUser);
    },

    async countUsers(filter): Promise<number> {
      return db.user.count({ where: userWhere(actor, filter) });
    },

    async findUser(userId): Promise<StoredUser | null> {
      const row = await db.user.findFirst({ where: { AND: [{ id: userId }, userScopeWhere(actor, "team")] }, select: USER_SELECT });
      return row ? toStoredUser(row) : null;
    },
  };
}

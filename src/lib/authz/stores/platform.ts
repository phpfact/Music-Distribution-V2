import "server-only";
/**
 * Storage of the PLATFORM domain: platform roles and platform owners in the
 * control plane (.vibe/memory/role-privilege-management.md, "Database").
 *
 * Implements the shared AuthzStore contract (./types.ts) so the role and
 * sub-user services stay one implementation for all domains. Platform owners
 * have no email and no customer; their single role is the NOT NULL column
 * platform_owners.role_id.
 */
import type { Prisma } from "@/generated/prisma/control/client";
import type { ControlDb } from "@/lib/db/control";
import type { IdentityConflicts } from "@/lib/workspace/identity";
import { loadDisabledPlatformModules, loadPlatformAccess } from "../platform-access";
import type { PlatformAuthzActor } from "../actor";
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
  UserChanges,
  UserFilter,
} from "./types";

// The role columns every read needs (privilege keys and the holder count).
const ROLE_SELECT = {
  id: true,
  name: true,
  description: true,
  status: true,
  systemKey: true,
  createdAt: true,
  updatedAt: true,
  permissions: { select: { permissionKey: true } },
  _count: { select: { owners: true } },
} as const satisfies Prisma.PlatformRoleSelect;

// The owner columns every read needs (never the password hash).
const USER_SELECT = {
  id: true,
  username: true,
  fullName: true,
  status: true,
  isPrimary: true,
  createdAt: true,
  role: { select: { id: true, name: true, status: true, systemKey: true, permissions: { select: { permissionKey: true } } } },
} as const satisfies Prisma.PlatformOwnerSelect;

type SelectedRole = Prisma.PlatformRoleGetPayload<{ select: typeof ROLE_SELECT }>;
type SelectedUser = Prisma.PlatformOwnerGetPayload<{ select: typeof USER_SELECT }>;

/**
 * Description: Turn a selected platform role into the shared StoredRole shape.
 * Input: The selected row.
 * Output: The StoredRole (domain platform, no owner customer).
 * Use case: Every role read of this store.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function toStoredRole(row: SelectedRole): StoredRole {
  return {
    id: row.id,
    domain: "platform",
    systemKey: row.systemKey,
    status: row.status,
    ownerCustomerId: null,
    permissionKeys: row.permissions.map((permission) => permission.permissionKey),
    name: row.name,
    description: row.description,
    userCount: row._count.owners,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Description: Turn a selected platform owner into the shared StoredUser shape.
 * Input: The selected row.
 * Output: The StoredUser (full name falls back to the username for legacy owners).
 * Use case: Every user read of this store.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function toStoredUser(row: SelectedUser): StoredUser {
  return {
    id: row.id,
    // Owners created before RBAC have no full name yet; the username identifies them.
    fullName: row.fullName ?? row.username,
    username: row.username,
    email: null,
    status: row.status === "active" ? "active" : "suspended",
    isPrimary: row.isPrimary,
    createdAt: row.createdAt,
    customerId: null,
    accountType: null,
    role: {
      id: row.role.id,
      domain: "platform",
      systemKey: row.role.systemKey,
      status: row.role.status,
      ownerCustomerId: null,
      permissionKeys: row.role.permissions.map((permission) => permission.permissionKey),
      name: row.role.name,
    },
  };
}

/**
 * Description: Build the database filter of a role list.
 * Input: The filter (search on name/description, status).
 * Output: The Prisma where-condition (Prisma escapes LIKE wildcards in `contains`).
 * Use case: listRoles and countRoles.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function roleWhere(filter: RoleFilter): Prisma.PlatformRoleWhereInput {
  const and: Prisma.PlatformRoleWhereInput[] = [];
  if (filter.q) {
    and.push({
      OR: [
        { name: { contains: filter.q, mode: "insensitive" } },
        { description: { contains: filter.q, mode: "insensitive" } },
      ],
    });
  }
  if (filter.status && filter.status !== "all") and.push({ status: filter.status });
  if (filter.excludeRoleId) and.push({ id: { not: filter.excludeRoleId } });
  if (filter.assignable) {
    // Eligibility is applied before COUNT/OFFSET/LIMIT, so later eligible roles remain reachable.
    const custom: Prisma.PlatformRoleWhereInput = {
      systemKey: null,
      permissions: { none: { permissionKey: { in: [...filter.assignable.forbiddenKeys] } } },
    };
    and.push(filter.assignable.allowMaster ? { OR: [{ systemKey: "master_platform" }, custom] } : custom);
  }
  return { AND: and };
}

/**
 * Description: Build the database filter of a platform owner list.
 * Input: The filter (search on full name/username, status, role).
 * Output: The Prisma where-condition. Both audiences cover every owner (the
 *   platform has one team); every owner holds a role (NOT NULL column).
 * Use case: listUsers and countUsers.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function userWhere(filter: UserFilter): Prisma.PlatformOwnerWhereInput {
  const and: Prisma.PlatformOwnerWhereInput[] = [];
  if (filter.q) {
    and.push({
      OR: [
        { fullName: { contains: filter.q, mode: "insensitive" } },
        { username: { contains: filter.q.toLowerCase() } },
      ],
    });
  }
  if (filter.status === "active") and.push({ status: "active" });
  if (filter.status === "suspended") and.push({ status: { not: "active" } });
  if (filter.roleId) and.push({ roleId: filter.roleId });
  return { AND: and };
}

/**
 * Description: Build the transaction operations of the platform store.
 * Input: The interactive control-plane transaction and the actor.
 * Output: The AuthzTxOps bound to this transaction.
 * Use case: createPlatformStore().transaction.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function platformTxOps(tx: Prisma.TransactionClient, actor: PlatformAuthzActor): AuthzTxOps {
  return {
    async reloadActor(): Promise<ReloadedActor> {
      // Step 1: share-lock the actor's own row and then its current role row (always
      // in this order, before any target lock). A concurrent role reassignment of the
      // actor (UPDATE platform_owners) or an edit of the actor's role (role row FOR
      // UPDATE) now waits for this transaction, or this one waits for it — never a
      // decision on a stale ceiling.
      const locked = await tx.$queryRaw<{ roleId: string }[]>`
        SELECT "role_id"::text AS "roleId" FROM "platform_owners" WHERE "id" = ${actor.userId}::uuid FOR SHARE`;
      const lockedRoleId = locked[0]?.roleId ?? null;
      if (lockedRoleId) await tx.$queryRaw`SELECT "id" FROM "platform_roles" WHERE "id" = ${lockedRoleId}::uuid FOR SHARE`;

      // Step 2: the actor's own row must still be active (a suspended owner grants nothing).
      const self = await tx.platformOwner.findUnique({ where: { id: actor.userId }, select: { status: true } });
      // Step 3: role, privileges and module switches, read fresh under those locks.
      const access          = await loadPlatformAccess(tx, actor.userId);
      const disabledModules = await loadDisabledPlatformModules(tx);
      const active          = self?.status === "active";
      return {
        domain: "platform",
        userId: actor.userId,
        roleId: access.roleId,
        isMaster: active && access.isMaster,
        isPrimary: access.isPrimary,
        permissions: active ? [...access.permissions] : [],
        disabledModules,
        mainCustomerId: null,
      };
    },

    async lockRole(roleId, mode): Promise<StoredRole | null> {
      // Lock first, then read the committed row (the lock waits for concurrent writers).
      if (mode === "update") await tx.$queryRaw`SELECT "id" FROM "platform_roles" WHERE "id" = ${roleId}::uuid FOR UPDATE`;
      else await tx.$queryRaw`SELECT "id" FROM "platform_roles" WHERE "id" = ${roleId}::uuid FOR SHARE`;
      const row = await tx.platformRole.findUnique({ where: { id: roleId }, select: ROLE_SELECT });
      return row ? toStoredRole(row) : null;
    },

    async isRoleNameTaken(name, excludeRoleId): Promise<boolean> {
      // Same comparison as the unique index platform_roles_name_lower_key: lower(name).
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id"::text AS "id" FROM "platform_roles"
        WHERE lower("name") = lower(${name})
          AND (${excludeRoleId}::uuid IS NULL OR "id" <> ${excludeRoleId}::uuid)
        LIMIT 1`;
      return rows.length > 0;
    },

    async insertRole(role: NewRole): Promise<string> {
      // The role and its privilege links in one nested write (inside the transaction).
      const created = await tx.platformRole.create({
        data: {
          name: role.name,
          description: role.description,
          status: role.status,
          createdById: role.createdById,
          permissions: { create: role.permissionKeys.map((permissionKey) => ({ permissionKey })) },
        },
        select: { id: true },
      });
      return created.id;
    },

    async updateRole(roleId: string, changes: RoleChanges): Promise<void> {
      await tx.platformRole.update({
        where: { id: roleId },
        data: { name: changes.name, description: changes.description, status: changes.status },
      });
    },

    async replaceRolePermissions(roleId, keys): Promise<void> {
      // Exactly the given keys afterwards: remove all, then insert the new set.
      await tx.platformRolePermission.deleteMany({ where: { roleId } });
      if (keys.length > 0) {
        await tx.platformRolePermission.createMany({ data: keys.map((permissionKey) => ({ roleId, permissionKey })) });
      }
    },

    async lockRoleHolders(roleId): Promise<string[]> {
      // Sorted, so two transactions lock the same owners in the same order.
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id"::text AS "id" FROM "platform_owners" WHERE "role_id" = ${roleId}::uuid ORDER BY "id" FOR UPDATE`;
      return rows.map((row) => row.id);
    },

    async reassignRoleHolders(fromRoleId, toRoleId): Promise<string[]> {
      // Step 1: who holds the role now (already locked by lockRoleHolders).
      const holders = await tx.platformOwner.findMany({ where: { roleId: fromRoleId }, select: { id: true }, orderBy: { id: "asc" } });
      // Step 2: one update moves them all (the single role column is replaced, never merged).
      await tx.platformOwner.updateMany({ where: { roleId: fromRoleId }, data: { roleId: toRoleId } });
      return holders.map((holder) => holder.id);
    },

    async deleteRole(roleId): Promise<void> {
      // RESTRICT on platform_owners.role_id: fails if anybody still holds it.
      await tx.platformRole.delete({ where: { id: roleId } });
    },

    async lockUser(userId): Promise<StoredUser | null> {
      await tx.$queryRaw`SELECT "id" FROM "platform_owners" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      const row = await tx.platformOwner.findUnique({ where: { id: userId }, select: USER_SELECT });
      return row ? toStoredUser(row) : null;
    },

    async lockIdentities(): Promise<void> {
      // Platform usernames are guarded by the unique index alone (no open registrations exist here).
    },

    async findIdentityConflicts(identity, excludeUserId): Promise<IdentityConflicts> {
      // Only usernames exist for platform owners.
      if (!identity.username) return {};
      const taken = await tx.platformOwner.count({
        where: { username: identity.username, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
      });
      return taken > 0 ? { username: "account" } : {};
    },

    async insertUser(user: NewUser): Promise<string> {
      const created = await tx.platformOwner.create({
        data: {
          username: user.username,
          passwordHash: user.passwordHash,
          fullName: user.fullName,
          status: "active",
          roleId: user.roleId,
          createdById: user.createdById,
          // Sub-Platform Owners are never primary (lockout protection belongs to the seeded owner).
          isPrimary: false,
        },
        select: { id: true },
      });
      return created.id;
    },

    async updateUser(userId: string, changes: UserChanges): Promise<void> {
      // Platform owners only have a full name to edit (no email, no account type).
      await tx.platformOwner.update({ where: { id: userId }, data: { fullName: changes.fullName } });
    },

    async assignRole(userId, roleId): Promise<void> {
      // One column = one role: the old role is replaced.
      await tx.platformOwner.update({ where: { id: userId }, data: { roleId } });
    },

    async setPassword(userId, passwordHash): Promise<void> {
      await tx.platformOwner.update({ where: { id: userId }, data: { passwordHash } });
      // A new password ends every open session of that owner.
      await tx.platformOwnerSession.deleteMany({ where: { ownerId: userId } });
    },

    async setUserStatus(userId, change): Promise<boolean> {
      const from    = change === "suspend" ? "active" : "disabled";
      const to      = change === "suspend" ? "disabled" : "active";
      const updated = await tx.platformOwner.updateMany({ where: { id: userId, status: from }, data: { status: to } });
      // A suspension ends every open session right away.
      if (updated.count === 1 && change === "suspend") await tx.platformOwnerSession.deleteMany({ where: { ownerId: userId } });
      return updated.count === 1;
    },
  };
}

/**
 * Description: Create the platform store for one actor.
 * Input: The control database client and the platform actor.
 * Output: The AuthzStore of the platform domain.
 * Use case: storeFor(actor) (stores/index.ts).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function createPlatformStore(db: ControlDb, actor: PlatformAuthzActor): AuthzStore {
  return {
    domain: "platform",

    transaction<T>(work: (ops: AuthzTxOps) => Promise<T>): Promise<T> {
      return db.$transaction((tx) => work(platformTxOps(tx, actor)));
    },

    async listRoles(filter, skip, take): Promise<StoredRole[]> {
      const rows = await db.platformRole.findMany({
        where: roleWhere(filter),
        select: ROLE_SELECT,
        // Master role first (system key set), then by name; id keeps the order deterministic.
        orderBy: [{ systemKey: { sort: "asc", nulls: "last" } }, { name: "asc" }, { id: "asc" }],
        skip,
        take,
      });
      return rows.map(toStoredRole);
    },

    async countRoles(filter): Promise<number> {
      return db.platformRole.count({ where: roleWhere(filter) });
    },

    async findRole(roleId): Promise<StoredRole | null> {
      const row = await db.platformRole.findUnique({ where: { id: roleId }, select: ROLE_SELECT });
      return row ? toStoredRole(row) : null;
    },

    async listUsers(filter, skip, take): Promise<StoredUser[]> {
      const rows = await db.platformOwner.findMany({
        where: userWhere(filter),
        select: USER_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
      });
      return rows.map(toStoredUser);
    },

    async countUsers(filter): Promise<number> {
      return db.platformOwner.count({ where: userWhere(filter) });
    },

    async findUser(userId): Promise<StoredUser | null> {
      const row = await db.platformOwner.findUnique({ where: { id: userId }, select: USER_SELECT });
      return row ? toStoredUser(row) : null;
    },
  };
}

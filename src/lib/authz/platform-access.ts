import "server-only";
/**
 * Effective privileges of a Platform Owner (or Sub-Platform Owner), read FRESH
 * from the control plane (.vibe/memory/role-privilege-management.md).
 *
 * No cache of any kind lives here: the request guards (platform.ts) memoize
 * per request only, so a role change, a revoked privilege, a disabled role or
 * a module switch applies on the very next request, on every app instance.
 *
 * Takes the database client as an argument, so it also runs inside an
 * existing transaction (the appearance service checks the privilege under
 * its own row lock).
 */
import type { ControlDb } from "@/lib/db/control";
import { isUuid } from "@/lib/uuid";
import { resolveEffectiveAccess, type EffectiveAccess, type RoleSnapshot } from "./resolver";

/** The client or interactive transaction the loader reads with. */
export type PlatformAuthzDb = Pick<ControlDb, "platformOwner" | "platformModuleSetting">;

/** A platform owner's effective access plus who they are. */
export type PlatformAccess = EffectiveAccess<"platform"> & {
  ownerId: string;
  /** The primary account (always Master Platform, lockout protected). */
  isPrimary: boolean;
  /**
   * The name of the owner's role (shown in the account menu), or null when the
   * owner was not found. Display text only: never used for a decision.
   */
  roleName: string | null;
};

/**
 * Description: Read the platform modules that are switched off platform-wide.
 * Input: The control database client or transaction.
 * Output: The module keys of `platform_module_settings` rows with enabled = false
 *   (an absent row means enabled; core modules are ignored later by the resolver).
 * Use case: loadPlatformAccess.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function loadDisabledPlatformModules(db: Pick<ControlDb, "platformModuleSetting">): Promise<string[]> {
  const rows = await db.platformModuleSetting.findMany({ where: { enabled: false }, select: { moduleKey: true } });
  return rows.map((row) => row.moduleKey);
}

/**
 * Description: Resolve the effective platform privileges of one owner.
 * Input: The control database client or transaction, and the owner id (taken
 *   from the verified session, never from the request).
 * Output: The effective access (role state, master flag, granted keys, can(),
 *   fingerprint) plus the owner id, primary flag and role name (display only).
 *   An unknown owner or a malformed id yields an empty set (role state "missing").
 * Use case: getPlatformAccess (every request) and the appearance service.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function loadPlatformAccess(db: PlatformAuthzDb, ownerId: string): Promise<PlatformAccess> {
  // Step 1: the owner's single role and its stored privilege keys (one query).
  const owner = isUuid(ownerId)
    ? await db.platformOwner.findUnique({
        where: { id: ownerId },
        select: {
          isPrimary: true,
          role: {
            select: {
              id: true,
              // Display text for the account menu; the decision uses system_key and keys only.
              name: true,
              status: true,
              systemKey: true,
              permissions: { select: { permissionKey: true } },
            },
          },
        },
      })
    : null;

  // Step 2: the platform modules switched off by the Platform Owner.
  const disabledModules = await loadDisabledPlatformModules(db);

  // Step 3: the decision (pure). A platform owner can only hold platform roles.
  const role: RoleSnapshot | null = owner
    ? {
        id: owner.role.id,
        domain: "platform",
        status: owner.role.status,
        systemKey: owner.role.systemKey,
        permissionKeys: owner.role.permissions.map((permission) => permission.permissionKey),
      }
    : null;
  const access = resolveEffectiveAccess({ domain: "platform", role, disabledModules });

  return { ...access, ownerId, isPrimary: owner?.isPrimary === true, roleName: owner?.role.name ?? null };
}

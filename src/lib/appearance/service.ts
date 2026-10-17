import "server-only";
import { cache } from "react";
import { recordAudit } from "@/lib/audit";
import { loadPlatformAccess } from "@/lib/authz/platform-access";
import { getControlDb, type ControlDb } from "@/lib/db/control";
import { SESSION_IDLE_TIMEOUT_MS, type PlatformSession } from "@/lib/platform-auth/session";
import {
  DEFAULT_APPEARANCE,
  parseAppearance,
  parseAppearanceUpdate,
  resolveAppearance,
  type AppearanceActionResult,
  type AppearanceState,
} from "./preferences";
import { UUID_PATTERN } from "@/lib/uuid";

export type { AppearanceState } from "./preferences";

const GLOBAL_ID = "platform";
// The privilege that replaced the old platform_owners.can_manage_appearance
// column (.vibe/memory/role-privilege-management.md).
const GLOBAL_APPEARANCE_PRIVILEGE = "platform.appearance.manage_global";
type AppearanceDb = Pick<ControlDb, "platformOwner" | "platformAppearance" | "platformModuleSetting">;

/**
 * Description: Read the current account and global appearance without private peers.
 * Input: A control database/transaction and an optional server-authenticated owner ID.
 * Output: The complete resolved appearance, its source, and whether the owner
 *   currently holds the platform.appearance.manage_global privilege (resolved
 *   from the owner's role and the module switches, read fresh).
 * Use case: First render, background refresh, and uncached post-transaction results.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
async function readState(db: AppearanceDb, ownerId?: string): Promise<AppearanceState> {
  // Step 1: the global default and the (active) owner's personal override.
  const [globalRow, owner] = await Promise.all([
    db.platformAppearance.findUnique({ where: { id: GLOBAL_ID }, select: { theme: true, accent: true, width: true } }),
    ownerId && UUID_PATTERN.test(ownerId)
      ? db.platformOwner.findUnique({
          where: { id: ownerId, status: "active" },
          select: {
            id: true,
            personalAppearance: { select: { theme: true, accent: true, width: true } },
          },
        })
      : null,
  ]);

  // Step 2: the global permission comes from the owner's role (deny by default).
  const access          = owner ? await loadPlatformAccess(db, owner.id) : null;
  const canManageGlobal = access?.can(GLOBAL_APPEARANCE_PRIVILEGE) === true;

  // Step 3: personal → global → application default.
  const personal = parseAppearance(owner?.personalAppearance);
  const global   = parseAppearance(globalRow);
  return {
    ownerId: owner?.id ?? null,
    personal,
    global,
    ...resolveAppearance(personal, global),
    canManageGlobal,
  };
}

/**
 * Description: Deduplicate authoritative appearance reads within one render/request.
 * Input: An optional identity already verified by the server session mechanism.
 * Output: The requesting owner's complete resolved appearance state.
 * Use case: Platform layout and Appearance page share one request-local read.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-14
 */
export const getAppearanceState = cache(async (ownerId?: string): Promise<AppearanceState> => {
  return readState(getControlDb(), ownerId);
});

/**
 * Description: Persist one authorized appearance change atomically with its audit.
 * Input: The validated server session, an untrusted action input, and optional IP.
 * Output: Authoritative saved state or safe validation/authorization feedback.
 * Use case: Personal apply/reset, administrator global apply, and global reset.
 * Global apply updates only the initiating owner's existing personal override;
 * global reset leaves every personal override intact. An exclusive owner row lock
 * serializes that owner's writes before checking override existence; a shared
 * session lock still protects against revocation after a page was rendered.
 * Global changes need the platform.appearance.manage_global privilege, resolved
 * from the owner's role inside the same transaction, after the lock.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
export async function saveAppearance(
  session: PlatformSession,
  input: unknown,
  ipAddress?: string,
): Promise<AppearanceActionResult> {
  const update = parseAppearanceUpdate(input);
  if (!update) return { ok: false, error: "Choose a supported appearance and action." };
  if (update.expectedOwnerId && update.expectedOwnerId !== session.owner.id) {
    return { ok: false, error: "Your account has changed. Refresh the page before saving appearance settings." };
  }
  if (!UUID_PATTERN.test(session.owner.id) || !UUID_PATTERN.test(session.sessionId)) {
    return { ok: false, error: "Your session has expired. Sign in again to save appearance settings." };
  }

  return getControlDb().$transaction(async (tx): Promise<AppearanceActionResult> => {
    // Every appearance write first locks its initiating owner exclusively. This
    // serializes personal creates/resets with global apply, so updateMany cannot
    // miss a concurrently created override and return an unexpected old setting.
    // Keep only a shared session lock: revocation still waits until this commits.
    const owners = await tx.$queryRaw<{ id: string }[]>`
      SELECT o."id"::text AS "id"
      FROM "platform_owners" o
      JOIN "platform_owner_sessions" s ON s."owner_id" = o."id"
      WHERE o."id" = ${session.owner.id}::uuid
        AND s."id" = ${session.sessionId}::uuid
        AND o."status" = 'active'
        AND s."expires_at" > CURRENT_TIMESTAMP
        AND s."last_used_at" > CURRENT_TIMESTAMP - ${SESSION_IDLE_TIMEOUT_MS} * INTERVAL '1 millisecond'
      FOR UPDATE OF o FOR SHARE OF s`;
    const owner = owners[0];
    if (!owner) {
      return { ok: false, error: "Your session has expired. Sign in again to save appearance settings." };
    }
    // The global scope needs the privilege, read fresh under the owner lock
    // (a role change of this owner waits for this transaction).
    if (update.scope === "global") {
      const access = await loadPlatformAccess(tx, session.owner.id);
      if (!access.can(GLOBAL_APPEARANCE_PRIVILEGE)) {
        return { ok: false, error: "You do not have permission to change appearance for all users." };
      }
    }

    if (update.scope === "personal") {
      if (update.operation === "reset") {
        await tx.platformOwnerAppearance.deleteMany({ where: { ownerId: session.owner.id } });
      } else {
        await tx.platformOwnerAppearance.upsert({
          where: { ownerId: session.owner.id },
          create: { ownerId: session.owner.id, ...update.appearance },
          update: update.appearance,
        });
      }
    } else {
      // A reset writes the designated default explicitly; all overrides remain.
      const appearance = update.operation === "reset" ? DEFAULT_APPEARANCE : update.appearance;
      // The singleton primary key and upsert prevent duplicate global records.
      await tx.platformAppearance.upsert({
        where: { id: GLOBAL_ID },
        create: { id: GLOBAL_ID, ...appearance },
        update: appearance,
      });

      if (update.operation === "apply") {
        // A personal override takes precedence over the global default. Updating
        // only this existing row makes Apply to All immediately affect its actor
        // while preserving every other owner's appearance and avoiding a new
        // personal override for an actor who already inherits the global setting.
        await tx.platformOwnerAppearance.updateMany({
          where: { ownerId: session.owner.id },
          data: update.appearance,
        });
      }
    }

    await recordAudit(tx, {
      actorType: "super_admin",
      actorId: session.owner.id,
      tenantId: null,
      action: update.operation === "reset" ? "appearance.reset" : "appearance.applied",
      targetType: update.scope === "personal" ? "platform_owner" : "platform_appearance",
      targetId: update.scope === "personal" ? session.owner.id : GLOBAL_ID,
      metadata: { scope: update.scope },
      ipAddress,
    });
    return { ok: true, state: await readState(tx, session.owner.id) };
  });
}

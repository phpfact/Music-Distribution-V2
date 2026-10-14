import "server-only";
import { cache } from "react";
import { recordAudit } from "@/lib/audit";
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

export type { AppearanceState } from "./preferences";

const GLOBAL_ID = "platform";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type AppearanceDb = Pick<ControlDb, "platformOwner" | "platformAppearance">;

async function readState(db: AppearanceDb, ownerId?: string): Promise<AppearanceState> {
  const [globalRow, owner] = await Promise.all([
    db.platformAppearance.findUnique({ where: { id: GLOBAL_ID }, select: { theme: true, accent: true } }),
    ownerId && UUID_PATTERN.test(ownerId)
      ? db.platformOwner.findUnique({
          where: { id: ownerId, status: "active" },
          select: {
            id: true,
            canManageAppearance: true,
            personalAppearance: { select: { theme: true, accent: true } },
          },
        })
      : null,
  ]);
  const personal = parseAppearance(owner?.personalAppearance);
  const global = parseAppearance(globalRow);
  return {
    ownerId: owner?.id ?? null,
    personal,
    global,
    ...resolveAppearance(personal, global),
    canManageGlobal: owner?.canManageAppearance === true,
  };
}

/** Callers supply only a server-authenticated identity; no ID is accepted by actions. */
export const getAppearanceState = cache(async (ownerId?: string): Promise<AppearanceState> => {
  return readState(getControlDb(), ownerId);
});

/**
 * Authorize again inside the write transaction, including session expiry and
 * permission changes after the render. Row locks serialize owner disable and
 * session revocation with the write. Global operations never touch overrides.
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
    const owners = await tx.$queryRaw<{ canManageAppearance: boolean }[]>`
      SELECT o."can_manage_appearance" AS "canManageAppearance"
      FROM "platform_owners" o
      JOIN "platform_owner_sessions" s ON s."owner_id" = o."id"
      WHERE o."id" = ${session.owner.id}::uuid
        AND s."id" = ${session.sessionId}::uuid
        AND o."status" = 'active'
        AND s."expires_at" > CURRENT_TIMESTAMP
        AND s."last_used_at" > CURRENT_TIMESTAMP - ${SESSION_IDLE_TIMEOUT_MS} * INTERVAL '1 millisecond'
      FOR SHARE OF o, s`;
    const owner = owners[0];
    if (!owner) {
      return { ok: false, error: "Your session has expired. Sign in again to save appearance settings." };
    }
    if (update.scope === "global" && !owner.canManageAppearance) {
      return { ok: false, error: "You do not have permission to change appearance for all users." };
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
      await tx.platformAppearance.upsert({
        where: { id: GLOBAL_ID },
        create: { id: GLOBAL_ID, ...appearance },
        update: appearance,
      });
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

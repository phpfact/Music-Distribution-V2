import "server-only";
/**
 * Workspace appearance persistence: the tenant's default and each user's
 * personal override, both in the tenant's own database
 * (.vibe/memory/workspace-appearance.md).
 */
import { recordAudit } from "@/lib/audit";
import { getControlDb } from "@/lib/db/control";
import type { TenantDb } from "@/lib/db/tenant";
import { describeError } from "@/lib/platform-auth/session";
import {
  parseWorkspaceAppearance,
  parseWorkspaceAppearanceUpdate,
  resolveWorkspaceAppearance,
  WORKSPACE_DEFAULT_APPEARANCE,
  type WorkspaceAppearanceActionResult,
  type WorkspaceAppearanceState,
  type WorkspaceAppearanceValue,
} from "./appearance-options";

// The primary key of the single workspace default row (CHECK in the migration).
const WORKSPACE_ROW_ID = "workspace";
// Theme, accent and width only: exactly what an appearance is.
const APPEARANCE_SELECT = { theme: true, accent: true, width: true } as const;

/** Who saves: the signed-in user, their area and whether they own the workspace. */
export type AppearanceViewer = { userId: string; tenantId: string; isOwner: boolean };

export type AppearanceSaveResult = WorkspaceAppearanceActionResult;

/**
 * Description: Read the tenant's workspace default appearance.
 * Input: The tenant database.
 * Output: The stored default, or null when none is saved or it is invalid.
 * Use case: Public pages and every signed-in page (via getViewerAppearanceState).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
async function readWorkspaceDefault(db: TenantDb): Promise<WorkspaceAppearanceValue | null> {
  const row = await db.workspaceAppearance.findUnique({ where: { id: WORKSPACE_ROW_ID }, select: APPEARANCE_SELECT });
  return parseWorkspaceAppearance(row);
}

/**
 * Description: Resolve the appearance of a public page (no signed-in user).
 * Input: The tenant database.
 * Output: The workspace default, or the application default. Never throws: a
 *   read failure is logged and the application default is used, so the
 *   welcome, login and sign-up pages always render.
 * Use case: Welcome, login, sign-up and registration status pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function getPublicAppearance(db: TenantDb): Promise<WorkspaceAppearanceValue> {
  try {
    return resolveWorkspaceAppearance(null, await readWorkspaceDefault(db)).appearance;
  } catch (error) {
    console.error(`[workspace-appearance] could not read the workspace default: ${describeError(error)}`);
    return { ...WORKSPACE_DEFAULT_APPEARANCE };
  }
}

/**
 * Description: Read everything a signed-in page needs about its viewer's appearance.
 * Input: The tenant database and the viewer (user id, owner flag).
 * Output: Personal override, workspace default, the rendered appearance and its
 *   source, and whether the viewer may change the workspace default.
 * Use case: The tenant and customer layouts and their Appearance pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function getViewerAppearanceState(
  db: TenantDb,
  viewer: Pick<AppearanceViewer, "userId" | "isOwner">,
): Promise<WorkspaceAppearanceState> {
  // Step 1: the two stored levels (each falls back when missing or invalid).
  const personalRow = await db.userAppearance.findUnique({ where: { userId: viewer.userId }, select: APPEARANCE_SELECT });
  const personal    = parseWorkspaceAppearance(personalRow);
  const workspace   = await readWorkspaceDefault(db);

  // Step 2: personal → workspace → application default.
  return {
    personal,
    workspace,
    ...resolveWorkspaceAppearance(personal, workspace),
    canManageWorkspace: viewer.isOwner,
  };
}

/**
 * Description: Save or reset an appearance (personal, or the workspace default).
 * Input: The tenant database, the viewer (from the verified session, never the
 *   form) and the untrusted save request.
 * Output: The new state, or a friendly error (invalid request, no permission,
 *   account no longer active, save failure). Workspace-wide changes need the
 *   owner role; "Apply to all" also updates the owner's own existing override
 *   (other users' overrides stay); "Reset all" restores the application default.
 * Use case: The appearance Server Actions of the tenant and customer areas and
 *   the header's quick theme switch.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function saveViewerAppearance(
  db: TenantDb,
  viewer: AppearanceViewer,
  input: unknown,
  clientIp: string | null,
): Promise<AppearanceSaveResult> {
  // Step 1: the request must be one of the known operations with valid options.
  const update = parseWorkspaceAppearanceUpdate(input);
  if (!update) return { ok: false, error: "Choose a supported appearance and try again." };
  if (update.scope === "workspace" && !viewer.isOwner) {
    return { ok: false, error: "Only the workspace administrator can change the appearance for everyone." };
  }

  try {
    // Step 2: one transaction; the user row is locked so this user's saves run one at a time.
    const saved = await db.$transaction(async (tx) => {
      const users = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "users" WHERE "id" = ${viewer.userId}::uuid AND "status" = 'active' FOR UPDATE`;
      if (users.length === 0) return false;

      if (update.scope === "personal") {
        if (update.operation === "reset") {
          await tx.userAppearance.deleteMany({ where: { userId: viewer.userId } });
        } else {
          await tx.userAppearance.upsert({
            where: { userId: viewer.userId },
            create: { userId: viewer.userId, ...update.appearance },
            update: update.appearance,
          });
        }
        return true;
      }

      // Workspace scope (owner only, checked above).
      const appearance = update.operation === "reset" ? WORKSPACE_DEFAULT_APPEARANCE : update.appearance;
      await tx.workspaceAppearance.upsert({
        where: { id: WORKSPACE_ROW_ID },
        create: { id: WORKSPACE_ROW_ID, ...appearance },
        update: appearance,
      });
      if (update.operation === "apply") {
        // The owner sees the change at once even with a personal override.
        await tx.userAppearance.updateMany({ where: { userId: viewer.userId }, data: update.appearance });
      }
      return true;
    });
    if (!saved) return { ok: false, error: "Your session has ended. Sign in again to save your appearance." };

    // Step 3: audit after the commit (the audit log is in the control plane).
    try {
      await recordAudit(getControlDb(), {
        actorType: "tenant_user",
        actorId: viewer.userId,
        tenantId: viewer.tenantId,
        action: update.operation === "reset" ? "workspace_appearance.reset" : "workspace_appearance.applied",
        targetType: update.scope === "personal" ? "user_appearance" : "workspace_appearance",
        targetId: update.scope === "personal" ? viewer.userId : WORKSPACE_ROW_ID,
        metadata: { scope: update.scope },
        ipAddress: clientIp,
      });
    } catch (error) {
      console.error(`[workspace-appearance] audit not written: ${describeError(error)}`);
    }

    // Step 4: the authoritative new state.
    return { ok: true, state: await getViewerAppearanceState(db, viewer) };
  } catch (error) {
    console.error(`[workspace-appearance] tenant ${viewer.tenantId}: save failed: ${describeError(error)}`);
    return { ok: false, error: "Your appearance could not be saved. Please try again." };
  }
}

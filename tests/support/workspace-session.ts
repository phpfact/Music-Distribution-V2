import type { TenantDb } from "@/lib/db/tenant";
import { createUserSession, type SessionArea } from "@/lib/workspace/sessions";

/**
 * Description: Create a session fixture with the user's current password hash.
 * Input: Tenant database, tenant/user IDs and session area.
 * Output: A token, or throws when the fixture cannot authenticate.
 * Use case: Existing authorization fixtures; race tests pass a captured hash directly.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export async function createTestUserSession(
  db: TenantDb,
  tenantId: string,
  userId: string,
  area: SessionArea,
): Promise<string> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
  if (!user.passwordHash) throw new Error("the session fixture needs a password hash");
  const token = await createUserSession(db, tenantId, userId, area, user.passwordHash);
  if (!token) throw new Error("the session fixture was refused");
  return token;
}

import "server-only";
/**
 * The one place that picks the storage of an actor's domain
 * (.vibe/memory/role-privilege-management.md, "Technical Notes" → "Services").
 *
 * The database always comes from the actor (control plane for the platform;
 * the Host-resolved tenant database for tenant and customer actors), never
 * from a request value — so ids of another tenant can never be reached.
 */
import { getControlDb } from "@/lib/db/control";
import type { AuthzActor } from "../actor";
import { createPlatformStore } from "./platform";
import type { AuthzStore } from "./types";
import { createWorkspaceStore } from "./workspace";

export type * from "./types";

/**
 * Description: Create the store bound to one actor's domain and scope.
 * Input: The actor (built by src/lib/authz/actor.ts from server-resolved data).
 * Output: The platform store (control plane) or the workspace store (the
 *   actor's tenant database; customer actors also bound to their main customer).
 * Use case: Every function of role-service.ts and sub-user-service.ts.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function storeFor(actor: AuthzActor): AuthzStore {
  if (actor.domain === "platform") return createPlatformStore(getControlDb(), actor);
  return createWorkspaceStore(actor.scope.db, actor);
}

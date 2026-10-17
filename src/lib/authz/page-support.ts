import "server-only";
/**
 * Server-side plumbing shared by the RBAC pages and Server Actions of ALL
 * three panels (Platform, Tenant, Customer;
 * .vibe/memory/role-privilege-management.md, "Technical Notes" → "RBAC pages
 * (all panels)").
 *
 * Each panel keeps only two tiny area-specific functions in its own
 * `rbac-actor.ts`: the authorize call (authorizePlatformAction /
 * authorizeTenantAction / authorizeCustomerAction, or the page guard) and the
 * actor builder (platformActor / tenantActor / customerActor). Everything
 * around them lives here once:
 * - the client address of the request (audit rows),
 * - building the actor with a FRIENDLY failure (logged, never a raw error),
 * - the shapes the shared screens and action handlers understand.
 */
import { headers } from "next/headers";
import { clientIpFromForwardedFor } from "@/lib/platform-auth/rate-limit";
import { describeError } from "@/lib/platform-auth/session";
import type { AuthzActor } from "./actor";

/** Shown when a Server Action's actor could not be built (e.g. a database is unreachable). */
export const ACTOR_UNAVAILABLE = "This could not be done right now. Please try again.";

/** Shown when a page's actor could not be built (the services explain their own failures). */
export const PAGE_UNAVAILABLE = "This page could not be loaded right now. Please try again.";

/** An authorized Server Action actor, or the friendly refusal / failure message. */
export type AuthorizedActor<Actor extends AuthzActor = AuthzActor> = { ok: true; actor: Actor } | { ok: false; error: string };

/**
 * The actor of a page render after the page privilege was checked:
 * - `denied`: the viewer lacks the page privilege (the screen shows AccessDenied),
 * - `unavailable`: the actor could not be built (the screen shows a friendly error).
 */
export type PageActorResult =
  | { ok: true; actor: AuthzActor }
  | { ok: false; reason: "denied" }
  | { ok: false; reason: "unavailable"; error: string };

/** The fixed answer of a page opened without its privilege. */
export const PAGE_DENIED: PageActorResult = { ok: false, reason: "denied" };

/**
 * Description: Read the client address of the current request for the audit log.
 * Input: None (request headers).
 * Output: The normalized client IP (same rule as every other audited action;
 *   "unknown" is stored as NULL by the audit writer).
 * Use case: The authorize step of every panel's RBAC Server Actions.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function requestIpAddress(): Promise<string> {
  return clientIpFromForwardedFor((await headers()).get("x-forwarded-for"));
}

/**
 * Description: Build the actor of an AUTHORIZED Server Action, keeping a failure friendly.
 * Input: The panel's actor builder (already given the server-resolved area /
 *   access and the client address) and the privilege it was authorized for
 *   (only used in the log line).
 * Output: `{ ok: true, actor }`, or `{ ok: false, error }` with ACTOR_UNAVAILABLE
 *   when building failed (the technical reason is logged as `[rbac]`).
 * Use case: authorizePlatformActor / authorizeTenantActor / authorizeCustomerActor.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function actorOrFailure<Actor extends AuthzActor>(
  build: () => Promise<Actor>,
  permission: string,
): Promise<AuthorizedActor<Actor>> {
  try {
    return { ok: true, actor: await build() };
  } catch (error) {
    // Never shown to the user: the action answers with the friendly message instead.
    console.error(`[rbac] could not build the actor for ${permission}: ${describeError(error)}`);
    return { ok: false, error: ACTOR_UNAVAILABLE };
  }
}

/**
 * Description: Build the actor of a page render whose page privilege was already checked.
 * Input: The panel's actor builder and the page privilege (only used in the log line).
 * Output: `{ ok: true, actor }`, or `{ ok: false, reason: "unavailable", error }`
 *   with PAGE_UNAVAILABLE when building failed (logged as `[rbac]`).
 * Use case: platformPageActor / tenantPageActor / customerPageActor (the shared
 *   screens then show a friendly "could not be loaded" notice).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function pageActorOf(build: () => Promise<AuthzActor>, permission: string): Promise<PageActorResult> {
  try {
    return { ok: true, actor: await build() };
  } catch (error) {
    console.error(`[rbac] could not build the page actor for ${permission}: ${describeError(error)}`);
    return { ok: false, reason: "unavailable", error: PAGE_UNAVAILABLE };
  }
}

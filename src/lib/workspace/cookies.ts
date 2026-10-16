import "server-only";
/**
 * The tenant portal's session cookies (.vibe/memory/workspace-auth.md).
 *
 * One cookie per area, each scoped to its own path, so the browser never even
 * sends a customer cookie to /tenant/** (or the other way round). Host-only
 * (no Domain attribute): a cookie set on one tenant's domain is never sent to
 * another tenant, the platform host or a subdomain.
 */
import { getEnv } from "@/lib/env";
import { WORKSPACE_SESSION_ABSOLUTE_LIFETIME_MS, type SessionArea } from "./sessions";

/** Every session cookie of the portal: its name and the only path it is sent to. */
export const WORKSPACE_COOKIES = {
  tenant:       { name: "md_tenant_session",       path: "/tenant" },
  customer:     { name: "md_customer_session",     path: "/customer" },
  registration: { name: "md_registration_session", path: "/customer/registration" },
} as const;

export type WorkspaceCookieKind = SessionArea | "registration";

/**
 * Description: Build the options of one portal session cookie.
 * Input: Which cookie (tenant, customer or registration).
 * Output: httpOnly, Secure in production, SameSite=Lax, its own path and an
 *   8-hour max age. `domain` is never set, so the cookie stays host-only.
 * Use case: Setting a cookie at sign-in and deleting it at sign-out (same name and path).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function workspaceCookieOptions(kind: WorkspaceCookieKind) {
  return {
    httpOnly: true,
    secure: getEnv().nodeEnv === "production",
    sameSite: "lax",
    path: WORKSPACE_COOKIES[kind].path,
    maxAge: WORKSPACE_SESSION_ABSOLUTE_LIFETIME_MS / 1000,
  } as const;
}

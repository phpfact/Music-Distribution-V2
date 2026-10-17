import "server-only";
/**
 * The guards every tenant-portal page, layout and Server Action calls
 * (.vibe/memory/workspace-auth.md).
 *
 * A layout is NOT a guard (layouts do not re-render on client navigation), so
 * every page and every action calls one of these itself. Each guard:
 *   1. resolves the tenant from the Host header (getWorkspace);
 *   2. reads ONLY its own area's cookie;
 *   3. validates the session in that tenant's database for that area;
 *   4. (tenant and customer areas) attaches the user's effective privileges
 *      (`authz`, .vibe/memory/role-privilege-management.md). Privilege checks
 *      for actions: src/lib/authz/workspace.ts.
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { EffectiveAccess } from "@/lib/authz/resolver";
import { getDisabledTenantModules, resolveWorkspaceAccess } from "@/lib/authz/workspace-access";
import { getWorkspace, type ReadyWorkspace, type Workspace } from "./context";
import { WORKSPACE_COOKIES } from "./cookies";
import {
  validateRegistrationSession,
  validateUserSession,
  type SessionArea,
  type WorkspaceApplicant,
  type WorkspaceUser,
} from "./sessions";

export const LOGIN_PATH               = "/login";
export const TENANT_HOME_PATH         = "/tenant/dashboard";
export const CUSTOMER_HOME_PATH       = "/customer/dashboard";
export const REGISTRATION_STATUS_PATH = "/customer/registration";

/** A signed-in staff user with their effective tenant privileges. */
export type TenantArea    = ReadyWorkspace & { user: WorkspaceUser; authz: EffectiveAccess<"tenant"> };
/** A signed-in customer user with their effective customer privileges. */
export type CustomerArea  = ReadyWorkspace & {
  user: WorkspaceUser & { customer: NonNullable<WorkspaceUser["customer"]> };
  authz: EffectiveAccess<"customer">;
};
export type ApplicantArea = ReadyWorkspace & { applicant: WorkspaceApplicant };
/** What the background privilege check returns: nothing but these two facts. */
export type AreaFingerprint = { signedIn: boolean; fingerprint: string | null };

/**
 * Description: Require a tenant that may be served, or leave the page.
 * Input: The resolved workspace.
 * Output: The ready workspace. Unknown host → 404 page; suspended or unfinished
 *   tenant → redirect to "/", which shows the friendly notice; database
 *   unavailable → an error for the friendly error page (details are in the log).
 * Use case: Every guard below and the public portal pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function readyOrLeave(workspace: Workspace): ReadyWorkspace {
  if (workspace.state === "ready") return workspace;
  if (workspace.state === "unknown") notFound();
  if (workspace.state === "unavailable") throw new Error("The workspace is temporarily unavailable.");
  redirect("/");
}

/**
 * Description: Require a ready workspace for a public portal page.
 * Input: None (reads the Host header).
 * Output: The ready workspace (see readyOrLeave for the other cases).
 * Use case: /login, /customer/signup.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function requireReadyWorkspace(): Promise<ReadyWorkspace> {
  return readyOrLeave(await getWorkspace());
}

/**
 * Description: Read the signed-in tenant staff user of this request, if any.
 * Input: None (Host header and the `md_tenant_session` cookie).
 * Output: The workspace, the user and their effective tenant privileges, or
 *   null when signed out / expired / suspended. Memoized for one request.
 * Use case: requireTenantUser.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-16
 */
const getTenantArea = cache(async (): Promise<TenantArea | null> => {
  const workspace = readyOrLeave(await getWorkspace());
  const token     = (await cookies()).get(WORKSPACE_COOKIES.tenant.name)?.value;
  if (!token) return null;
  // Step 1: session, user and role (one tenant query).
  const user = await validateUserSession(workspace.db, workspace.tenant.id, "tenant", token);
  if (!user) return null;
  // Step 2: the tenant's module switches (one control-plane query per request).
  const disabledModules = await getDisabledTenantModules(workspace.tenant.id);
  return { ...workspace, user, authz: resolveWorkspaceAccess(user, "tenant", disabledModules) };
});

/**
 * Description: Require a signed-in tenant staff user.
 * Input: None.
 * Output: The workspace, the user and `authz`; anyone else is redirected to /login.
 * Use case: Every /tenant/** page, layout and Server Action.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-16
 */
export async function requireTenantUser(): Promise<TenantArea> {
  const area = await getTenantArea();
  if (!area) redirect(LOGIN_PATH);
  return area;
}

/**
 * Description: Read the signed-in customer user of this request, if any.
 * Input: None (Host header and the `md_customer_session` cookie).
 * Output: The workspace, the customer user and their effective customer
 *   privileges, or null (also when the customer or its main customer is
 *   suspended). Memoized for one request.
 * Use case: requireCustomer.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-16
 */
const getCustomerArea = cache(async (): Promise<CustomerArea | null> => {
  const workspace = readyOrLeave(await getWorkspace());
  const token     = (await cookies()).get(WORKSPACE_COOKIES.customer.name)?.value;
  if (!token) return null;
  // Step 1: session, user, customer (and its main customer) and role (one tenant query).
  const user = await validateUserSession(workspace.db, workspace.tenant.id, "customer", token);
  if (!user || !user.customer) return null;
  // Step 2: the tenant's module switches (one control-plane query per request).
  const disabledModules = await getDisabledTenantModules(workspace.tenant.id);
  return {
    ...workspace,
    user: { ...user, customer: user.customer },
    authz: resolveWorkspaceAccess(user, "customer", disabledModules),
  };
});

/**
 * Description: Require a signed-in customer.
 * Input: None.
 * Output: The workspace, the customer user and `authz`; anyone else is
 *   redirected to /login.
 * Use case: Every protected /customer/** page, layout and Server Action.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-16
 */
export async function requireCustomer(): Promise<CustomerArea> {
  const area = await getCustomerArea();
  if (!area) redirect(LOGIN_PATH);
  return area;
}

/**
 * Description: Read the rejected applicant of this request, if any.
 * Input: None (Host header and the `md_registration_session` cookie).
 * Output: The workspace and the applicant, or null. Memoized for one request.
 * Use case: requireApplicant.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
const getApplicantArea = cache(async (): Promise<ApplicantArea | null> => {
  const workspace = readyOrLeave(await getWorkspace());
  const token     = (await cookies()).get(WORKSPACE_COOKIES.registration.name)?.value;
  if (!token) return null;
  const applicant = await validateRegistrationSession(workspace.db, workspace.tenant.id, token);
  return applicant ? { ...workspace, applicant } : null;
});

/**
 * Description: Require an applicant's limited registration session.
 * Input: None.
 * Output: The workspace and the applicant; anyone else is redirected to /login.
 * Use case: /customer/registration and its review-request action.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function requireApplicant(): Promise<ApplicantArea> {
  const area = await getApplicantArea();
  if (!area) redirect(LOGIN_PATH);
  return area;
}

/**
 * Description: Read the privilege fingerprint of this request's tenant or
 *   customer session WITHOUT counting the call as user activity.
 * Input: The area ("tenant" or "customer"); the tenant comes from the Host
 *   header and the token from that area's own cookie.
 * Output: { signedIn: false, fingerprint: null } when there is no valid session
 *   (signed out, expired, idle, suspended, tenant not ready); otherwise
 *   { signedIn: true, fingerprint } — the hash of the user's current role and
 *   privileges (.vibe/memory/role-privilege-management.md). Never anything else.
 *   The session is validated with touch: false, so this background poll never
 *   extends the idle timeout. Database errors are thrown (the caller logs them
 *   and the browser stays silent).
 * Use case: The tenant and customer fingerprint Server Actions polled by
 *   PermissionSync (src/components/shared/permission-sync.tsx).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function readAreaFingerprint(area: SessionArea): Promise<AreaFingerprint> {
  const signedOut: AreaFingerprint = { signedIn: false, fingerprint: null };

  // Step 1: the tenant of this host; a suspended/unknown tenant has no session.
  const workspace = await getWorkspace();
  if (workspace.state !== "ready") return signedOut;

  // Step 2: this area's own cookie only.
  const token = (await cookies()).get(WORKSPACE_COOKIES[area].name)?.value;
  if (!token) return signedOut;

  // Step 3: the session and role, validated WITHOUT touching last_used_at.
  const user = await validateUserSession(workspace.db, workspace.tenant.id, area, token, { touch: false });
  if (!user || (area === "customer" && !user.customer)) return signedOut;

  // Step 4: the same decision the guards make (module switches read fresh).
  const disabledModules = await getDisabledTenantModules(workspace.tenant.id);
  return { signedIn: true, fingerprint: resolveWorkspaceAccess(user, area, disabledModules).fingerprint };
}

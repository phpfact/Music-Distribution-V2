import "server-only";
/**
 * The guards every tenant-portal page, layout and Server Action calls
 * (.vibe/memory/workspace-auth.md).
 *
 * A layout is NOT a guard (layouts do not re-render on client navigation), so
 * every page and every action calls one of these itself. Each guard:
 *   1. resolves the tenant from the Host header (getWorkspace);
 *   2. reads ONLY its own area's cookie;
 *   3. validates the session in that tenant's database for that area.
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getWorkspace, type ReadyWorkspace, type Workspace } from "./context";
import { WORKSPACE_COOKIES } from "./cookies";
import {
  validateRegistrationSession,
  validateUserSession,
  type WorkspaceApplicant,
  type WorkspaceUser,
} from "./sessions";

export const LOGIN_PATH               = "/login";
export const TENANT_HOME_PATH         = "/tenant/dashboard";
export const CUSTOMER_HOME_PATH       = "/customer/dashboard";
export const REGISTRATION_STATUS_PATH = "/customer/registration";

export type TenantArea    = ReadyWorkspace & { user: WorkspaceUser };
export type CustomerArea  = ReadyWorkspace & { user: WorkspaceUser & { customer: NonNullable<WorkspaceUser["customer"]> } };
export type ApplicantArea = ReadyWorkspace & { applicant: WorkspaceApplicant };

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
 * Output: The workspace and user, or null when signed out / expired / suspended.
 *   Memoized for one request.
 * Use case: requireTenantUser.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
const getTenantArea = cache(async (): Promise<TenantArea | null> => {
  const workspace = readyOrLeave(await getWorkspace());
  const token     = (await cookies()).get(WORKSPACE_COOKIES.tenant.name)?.value;
  if (!token) return null;
  const user = await validateUserSession(workspace.db, workspace.tenant.id, "tenant", token);
  return user ? { ...workspace, user } : null;
});

/**
 * Description: Require a signed-in tenant staff user.
 * Input: None.
 * Output: The workspace and the user; anyone else is redirected to /login.
 * Use case: Every /tenant/** page, layout and Server Action.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function requireTenantUser(): Promise<TenantArea> {
  const area = await getTenantArea();
  if (!area) redirect(LOGIN_PATH);
  return area;
}

/**
 * Description: Read the signed-in customer user of this request, if any.
 * Input: None (Host header and the `md_customer_session` cookie).
 * Output: The workspace and the customer user, or null. Memoized for one request.
 * Use case: requireCustomer.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
const getCustomerArea = cache(async (): Promise<CustomerArea | null> => {
  const workspace = readyOrLeave(await getWorkspace());
  const token     = (await cookies()).get(WORKSPACE_COOKIES.customer.name)?.value;
  if (!token) return null;
  const user = await validateUserSession(workspace.db, workspace.tenant.id, "customer", token);
  if (!user || !user.customer) return null;
  return { ...workspace, user: { ...user, customer: user.customer } };
});

/**
 * Description: Require a signed-in customer.
 * Input: None.
 * Output: The workspace and the customer user; anyone else is redirected to /login.
 * Use case: Every protected /customer/** page, layout and Server Action.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
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

/**
 * One-off success notices of the shared RBAC screens of every panel
 * (Platform, Tenant, Customer: roles, Sub-Platform Owners, Sub-Tenants,
 * Sub-Customers; .vibe/memory/role-privilege-management.md, "Technical Notes"
 * → "RBAC pages (all panels)").
 *
 * After a successful create/save/delete the Server Action (or the details
 * page's client actions) redirects with `?notice=<code>`; the target page
 * turns the code into a FIXED message. The URL only picks a message, it never
 * supplies the text, so a crafted link cannot show arbitrary words.
 *
 * Pure and client-safe: used by the shared action handlers, the server
 * screens and the role details client actions.
 */

/** Every notice code the RBAC screens understand. */
export type RbacNoticeCode =
  | "role-created"
  | "role-saved"
  | "role-deleted"
  | "role-disabled"
  | "role-enabled"
  | "user-created"
  | "user-saved";

// Fixed wording per code (same tone as the services' own success messages).
const RBAC_NOTICES: Readonly<Record<RbacNoticeCode, string>> = {
  "role-created":  "Role created. Assign it to a user to give them its privileges.",
  "role-saved":    "Role saved. Its users get the new privileges on their next request.",
  "role-deleted":  "Role deleted. Any users who held it now hold the replacement role you chose.",
  "role-disabled": "Role disabled. Its users lose their protected access on their next request.",
  "role-enabled":  "Role enabled. Its users get its privileges again on their next request.",
  "user-created":  "Account created. It can log in now with its role.",
  "user-saved":    "Account saved. Role changes apply on the user's next request.",
};

/**
 * Description: Turn a `?notice=` value into its fixed message.
 * Input: The raw search parameter (missing, one value or repeated).
 * Output: The message, or null for a missing or unknown code.
 * Use case: Every RBAC list/details page (all panels) after a redirect.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function rbacNoticeMessage(value: string | string[] | undefined): string | null {
  // Step 1: only the first value counts (a repeated parameter is not an error).
  const code = Array.isArray(value) ? value[0] : value;

  // Step 2: unknown codes show nothing (never echo the URL's text).
  if (code === undefined || !Object.hasOwn(RBAC_NOTICES, code)) return null;
  return RBAC_NOTICES[code as RbacNoticeCode];
}

/**
 * Description: Add a notice code to a page path.
 * Input: The target path (without a query string) and the code.
 * Output: `<path>?notice=<code>`.
 * Use case: Redirects of the Server Actions and the role details client actions.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function withRbacNotice(path: string, code: RbacNoticeCode): string {
  return `${path}?notice=${code}`;
}

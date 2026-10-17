/**
 * Field rules, list rules and view types of the tenant's Customers module
 * (.vibe/memory/customer-management.md).
 *
 * Nothing new is invented for a person: every field rule is the rule of the
 * Sub-Customer form (src/lib/authz/sub-user-rules.ts, which composes the shared
 * tenant rules), so a customer created by tenant staff, a Sub-Customer and a
 * public sign-up are always checked the same way. The client form and the
 * server service both use the functions below.
 *
 * Client-safe: no `server-only`, no `node:` imports, no database access.
 */
import type { PageView, RecordsResult, UserStatusChange } from "@/components/rbac/types";
import type { RbacStatusFilter } from "@/components/rbac/list-href";
import { subUserFieldError, type SubUserFields } from "@/lib/authz/sub-user-rules";
import { validateEmail, validateFullName, validateTenantUsername } from "@/lib/tenants/rules";
import { validateAccountType, type AccountType } from "./rules";

// ---------------------------------------------------------------------------
// The "Add customer" form

/** Every field of the "Add customer" form (FormData keys). */
export type CustomerFields = {
  fullName: string;
  accountType: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
};

export type CustomerFieldName   = keyof CustomerFields;
export type CustomerFieldErrors = Partial<Record<CustomerFieldName, string>>;

/**
 * The page order of the fields: Personal Information (full name, account
 * type), then Login Information (username, email, password, confirmation).
 * The first invalid one gets the focus; the server reads exactly these keys.
 */
export const CUSTOMER_FIELD_ORDER: readonly CustomerFieldName[] = [
  "fullName",
  "accountType",
  "username",
  "email",
  "password",
  "confirmPassword",
];

/** Fields whose surrounding spaces are meaningless (trimmed on blur and submit). */
export const CUSTOMER_TRIMMED_FIELDS: readonly CustomerFieldName[] = ["fullName", "username", "email"];

/** The values of a valid form, normalized the way they are stored. */
export type ValidCustomer = {
  fullName: string;
  accountType: AccountType;
  /** Lower-case. */
  username: string;
  /** Lower-case. */
  email: string;
  /** Exactly as typed (a password is never trimmed or changed). */
  password: string;
};

/**
 * Description: Check one field of the "Add customer" form.
 * Input: The field and every current value (the password rule needs the
 *   username, the confirmation needs the password).
 * Output: The message shown under that field, or undefined when it is valid.
 *   Same rules and texts as the Sub-Customer create form (required full name,
 *   account type, username, email, master-password rule, matching confirmation).
 * Use case: Live (typing / blur) validation of the form and validateCustomerFields.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export function customerFieldError(name: CustomerFieldName, fields: CustomerFields): string | undefined {
  // The Sub-Customer rules also know a role field; a customer has none (always Master Customer).
  const asSubUser: SubUserFields = { ...fields, roleId: "" };
  return subUserFieldError(name, asSubUser, "create");
}

/**
 * Description: Check the whole "Add customer" form.
 * Input: Every field as typed (untrusted on the server).
 * Output: `{ ok: true, value }` with the normalized values, or
 *   `{ ok: false, fieldErrors }` with one message per invalid field (page order).
 * Use case: The form's submit (client) and createCustomer (server).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export function validateCustomerFields(
  fields: CustomerFields,
): { ok: true; value: ValidCustomer } | { ok: false; fieldErrors: CustomerFieldErrors } {
  // Step 1: one message per invalid field, in page order.
  const fieldErrors: CustomerFieldErrors = {};
  for (const name of CUSTOMER_FIELD_ORDER) {
    const error = customerFieldError(name, fields);
    if (error) fieldErrors[name] = error;
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  // Step 2: every rule passed; the rules also return the normalized values.
  const fullName    = validateFullName(fields.fullName);
  const accountType = validateAccountType(fields.accountType);
  const username    = validateTenantUsername(fields.username);
  const email       = validateEmail(fields.email);
  if (!fullName.ok || !accountType.ok || !username.ok || !email.ok) {
    // Unreachable: step 1 already ran these rules.
    return { ok: false, fieldErrors: { fullName: "Check the form and try again." } };
  }
  return {
    ok: true,
    value: {
      fullName: fullName.value,
      accountType: accountType.value,
      username: username.value,
      email: email.value,
      password: fields.password,
    },
  };
}

/**
 * Result of the "Add customer" Server Action (useActionState state).
 * idle: nothing submitted yet; error: messages under the fields and/or a
 * form-level message. On success the action redirects, so there is no
 * success state. Passwords are never sent back.
 */
export type CustomerFormState =
  | { status: "idle" }
  | { status: "error"; fieldErrors: CustomerFieldErrors; formMessage?: string };

// ---------------------------------------------------------------------------
// The customers list

/** Where a main customer came from (display only). */
export type CustomerSource = "signup" | "tenant";

export const CUSTOMER_SOURCE_LABELS: Record<CustomerSource, string> = {
  signup: "Sign-up",
  tenant: "Added by tenant",
};

/** A customer's stored status: "disabled" is shown as Suspended. */
export type CustomerStatusValue = "active" | "disabled";

/** One main customer as the list, the popups and the dashboard show it. */
export type CustomerRow = {
  id: string;
  /** The customer's name (the full name entered at creation / sign-up). */
  name: string;
  accountType: AccountType;
  status: CustomerStatusValue;
  /** The primary account's login fields (null when a legacy customer has no user). */
  username: string | null;
  email: string | null;
  source: CustomerSource;
  /** ISO date-time. */
  createdAt: string;
};

/** The customers summary figures (total = active + suspended). */
export type CustomerSummary = { total: number; active: number; suspended: number };

/** The list query: search text, status filter and page (from the URL). */
export type CustomerListQuery = { q: string; status: RbacStatusFilter; page: number };

/** One server page of customers. */
export type CustomerPage = PageView<CustomerRow>;

/** What the count-details Server Action answers. */
export type CustomerRecordsResult = RecordsResult<CustomerRow>;

/** The change a Suspend / Reactivate button asks for (from the status the row shows). */
export type CustomerStatusChange = UserStatusChange;

/** What the suspend / reactivate Server Action answers. */
export type CustomerActionResult = { ok: true; message: string } | { ok: false; error: string };

/** The status filters a count-details popup may ask for. */
const CUSTOMER_FILTERS: readonly RbacStatusFilter[] = ["all", "active", "disabled"];

/**
 * Description: Check the filter a count-details popup asks for.
 * Input: An untrusted value from a Server Action argument.
 * Output: "all", "active" or "disabled", or null for anything else.
 * Use case: loadTenantCustomerRecordsAction.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export function parseCustomerFilter(value: unknown): RbacStatusFilter | null {
  return CUSTOMER_FILTERS.find((filter) => filter === value) ?? null;
}

/**
 * Description: Check a suspend / reactivate request's change.
 * Input: An untrusted value from a Server Action argument.
 * Output: "suspend" or "reactivate", or null for anything else.
 * Use case: setTenantCustomerStatusAction / setCustomerStatus.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export function parseCustomerStatusChange(value: unknown): CustomerStatusChange | null {
  return value === "suspend" || value === "reactivate" ? value : null;
}

// ---------------------------------------------------------------------------
// One-off notices after a redirect (fixed codes, never free text from the URL)

const CUSTOMER_NOTICES = {
  "customer-created": "The customer was created. Share the username and password with them: they can log in right away.",
} as const;

/**
 * Description: Turn a notice code from the URL into its fixed message.
 * Input: The `notice` search parameter (untrusted; may be missing or repeated).
 * Output: The message for a known code, otherwise null (unknown text is never shown).
 * Use case: /tenant/customers after "Add customer".
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export function customerNoticeMessage(value: string | string[] | undefined): string | null {
  const code = Array.isArray(value) ? value[0] : value;
  return code && Object.hasOwn(CUSTOMER_NOTICES, code) ? CUSTOMER_NOTICES[code as keyof typeof CUSTOMER_NOTICES] : null;
}

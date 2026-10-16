/**
 * Field rules of the tenant portal (workspace): sign-in, customer sign-up,
 * registration review and the registrations list
 * (.vibe/memory/workspace-auth.md, customer-registration.md).
 *
 * The server applies these as the source of truth; client components import
 * the same functions for instant feedback. So this module must stay pure: no
 * `server-only`, no `node:` imports, no environment access.
 *
 * The person rules (full name, email, username, password) are the existing
 * tenant rules (src/lib/tenants/rules.ts), reused so both places stay identical.
 */
import {
  checkMasterPassword,
  EMAIL_MAX_LENGTH,
  FULL_NAME_MAX_LENGTH,
  MASTER_PASSWORD_MAX_LENGTH,
  MASTER_PASSWORD_MIN_LENGTH,
  TENANT_USERNAME_MAX_LENGTH,
  validateEmail,
  validateFullName,
  validateMasterPassword,
  validateTenantUsername,
  type PasswordCheck,
  type RuleResult,
} from "@/lib/tenants/rules";

export type { PasswordCheck, RuleResult };

// ---------------------------------------------------------------------------
// Shared limits (also passed to the forms as maxLength attributes)

/** Shortest identifier: the shortest valid username (3 characters). */
export const LOGIN_IDENTIFIER_MIN_LENGTH = 3;
/** Longest identifier: the longest valid email address. */
export const LOGIN_IDENTIFIER_MAX_LENGTH = EMAIL_MAX_LENGTH;
/** Equal to PASSWORD_MAX_LENGTH in platform-auth/password.ts, which hashes it. */
export const WORKSPACE_PASSWORD_MAX_LENGTH = MASTER_PASSWORD_MAX_LENGTH;
export const WORKSPACE_PASSWORD_MIN_LENGTH = MASTER_PASSWORD_MIN_LENGTH;
export const SIGNUP_FULL_NAME_MAX_LENGTH   = FULL_NAME_MAX_LENGTH;
export const SIGNUP_EMAIL_MAX_LENGTH       = EMAIL_MAX_LENGTH;
export const SIGNUP_USERNAME_MAX_LENGTH    = TENANT_USERNAME_MAX_LENGTH;
export const REJECTION_REASON_MIN_LENGTH   = 3;
export const REJECTION_REASON_MAX_LENGTH   = 500;
export const REVIEW_MESSAGE_MAX_LENGTH     = 1000;

/**
 * Description: Wrap a valid, normalized value in a successful rule result.
 * Input: The value the rule accepted.
 * Output: `{ ok: true, value }`.
 * Use case: Every validator in this module.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function ok<T>(value: T): RuleResult<T> {
  return { ok: true, value };
}

/**
 * Description: Wrap a user-facing error message in a failed rule result.
 * Input: The message shown under the field.
 * Output: `{ ok: false, error }`.
 * Use case: Every validator in this module.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function fail<T>(error: string): RuleResult<T> {
  return { ok: false, error };
}

/**
 * Description: Read a submitted value without trusting its type.
 * Input: Any value taken from FormData or a request.
 * Output: The value when it is a string; "" for anything else (null, File, number).
 * Use case: Server actions and services that receive untrusted input.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// ---------------------------------------------------------------------------
// Sign-in (/login)

export type LoginFields      = { identifier: string; password: string };
export type LoginFieldErrors = { identifier?: string; password?: string };

/**
 * Description: Bring a typed username or email into the form it is stored in.
 * Input: The raw text from the "Username or email" field.
 * Output: The text trimmed and lower-cased (usernames and emails are stored lower-case).
 * Use case: Sign-in (client and server) and the sign-in rate-limit key.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function normalizeLoginIdentifier(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Description: Tell whether a normalized identifier is an email address.
 * Input: The normalized identifier.
 * Output: True when it contains "@" (usernames can never contain it).
 * Use case: The sign-in lookup (email column or username column).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function isEmailIdentifier(identifier: string): boolean {
  return identifier.includes("@");
}

/**
 * Description: Check the sign-in form's two fields.
 * Input: The identifier (username or email) and the password, as typed.
 * Output: The field errors (empty object when both are fine). The identifier is
 *   checked for presence and length only: its format is never revealed on the
 *   sign-in page (a malformed name is reported like any wrong credential).
 * Use case: The login form (blur, typing, submit) and the sign-in service.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function validateLoginFields(fields: LoginFields): LoginFieldErrors {
  const errors: LoginFieldErrors = {};
  const identifier = normalizeLoginIdentifier(fields.identifier);

  // Step 1: the identifier is required and must fit the stored columns.
  if (identifier.length === 0) {
    errors.identifier = "Enter your username or email.";
  } else if (identifier.length < LOGIN_IDENTIFIER_MIN_LENGTH) {
    errors.identifier = `Enter at least ${LOGIN_IDENTIFIER_MIN_LENGTH} characters.`;
  } else if (identifier.length > LOGIN_IDENTIFIER_MAX_LENGTH) {
    errors.identifier = `Use at most ${LOGIN_IDENTIFIER_MAX_LENGTH} characters.`;
  }

  // Step 2: the password is required; whitespace-only counts as empty, but a
  // real password is used exactly as typed (never trimmed).
  if (fields.password.trim().length === 0) {
    errors.password = "Enter your password.";
  } else if (fields.password.length > WORKSPACE_PASSWORD_MAX_LENGTH) {
    errors.password = `Use at most ${WORKSPACE_PASSWORD_MAX_LENGTH} characters.`;
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Customer sign-up (/customer/signup)

/** The customer categories a public applicant may choose (owner decision 2026-10-15). */
export type AccountType = "artist" | "label" | "white_label";

export type AccountTypeOption = { value: AccountType; label: string; description: string };

export const ACCOUNT_TYPE_OPTIONS: readonly AccountTypeOption[] = [
  { value: "artist",      label: "Artist",      description: "A solo artist or band releasing their own music." },
  { value: "label",       label: "Label",       description: "A record label releasing music for its artists." },
  { value: "white_label", label: "White Label", description: "A partner distributing music under its own brand." },
];

/**
 * Description: Name an account type for display.
 * Input: The stored account type.
 * Output: "Artist", "Label" or "White Label".
 * Use case: Registration lists, details popups and the customer dashboard.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function accountTypeLabel(type: AccountType): string {
  return ACCOUNT_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? "Customer";
}

/**
 * Description: Check a submitted account type.
 * Input: The raw value from the form.
 * Output: The account type, or the error message.
 * Use case: Sign-up form and the registration service.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function validateAccountType(input: string): RuleResult<AccountType> {
  const option = ACCOUNT_TYPE_OPTIONS.find((candidate) => candidate.value === input);
  return option ? ok(option.value) : fail("Choose your account type.");
}

export type SignupFields = {
  fullName: string;
  accountType: string;
  email: string;
  username: string;
  password: string;
  confirmPassword: string;
};

export type SignupFieldName   = keyof SignupFields;
export type SignupFieldErrors = Partial<Record<SignupFieldName, string>>;

/** The order of the fields on the page (first invalid field gets the focus). */
export const SIGNUP_FIELD_ORDER: readonly SignupFieldName[] = [
  "fullName",
  "accountType",
  "email",
  "username",
  "password",
  "confirmPassword",
];

export type ValidSignup = {
  fullName: string;
  accountType: AccountType;
  email: string;
  username: string;
  password: string;
};

/**
 * Description: Check one sign-up field.
 * Input: The field name and every current value (the password rules need the
 *   username, the confirmation needs the password).
 * Output: The error message for that field, or undefined when it is valid.
 * Use case: Live (blur/typing) validation of one field and validateSignupFields.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function signupFieldError(name: SignupFieldName, fields: SignupFields): string | undefined {
  if (name === "fullName") {
    // The shared rule speaks about "the tenant"; the applicant enters their own name.
    if (fields.fullName.trim().length === 0) return "Enter your full name.";
    const result = validateFullName(fields.fullName);
    return result.ok ? undefined : result.error;
  }
  if (name === "accountType") {
    const result = validateAccountType(fields.accountType);
    return result.ok ? undefined : result.error;
  }
  if (name === "email") {
    const result = validateEmail(fields.email);
    return result.ok ? undefined : result.error;
  }
  if (name === "username") {
    const result = validateTenantUsername(fields.username);
    return result.ok ? undefined : result.error;
  }
  if (name === "password") {
    // The password must not contain the (normalized) username.
    const username = fields.username.trim().toLowerCase();
    const result   = validateMasterPassword(fields.password, username);
    return result.ok ? undefined : result.error;
  }
  // confirmPassword: required and identical to the password.
  if (fields.confirmPassword.length === 0) return "Confirm your password.";
  if (fields.confirmPassword !== fields.password) return "The passwords do not match.";
  return undefined;
}

/**
 * Description: Check the whole sign-up form.
 * Input: Every field as typed.
 * Output: `{ ok: true, value }` with normalized values (password unchanged), or
 *   `{ ok: false, fieldErrors }` with one message per invalid field.
 * Use case: Sign-up submit (client) and the registration service (server).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function validateSignupFields(
  fields: SignupFields,
): { ok: true; value: ValidSignup } | { ok: false; fieldErrors: SignupFieldErrors } {
  // Step 1: collect one message per invalid field, in page order.
  const fieldErrors: SignupFieldErrors = {};
  for (const name of SIGNUP_FIELD_ORDER) {
    const error = signupFieldError(name, fields);
    if (error) fieldErrors[name] = error;
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  // Step 2: every rule passed; return the normalized values.
  const fullName    = validateFullName(fields.fullName);
  const email       = validateEmail(fields.email);
  const username    = validateTenantUsername(fields.username);
  const accountType = validateAccountType(fields.accountType);
  if (!fullName.ok || !email.ok || !username.ok || !accountType.ok) {
    // Unreachable: step 1 already ran these rules.
    return { ok: false, fieldErrors: { fullName: "Check the form and try again." } };
  }
  return {
    ok: true,
    value: {
      fullName: fullName.value,
      accountType: accountType.value,
      email: email.value,
      username: username.value,
      password: fields.password,
    },
  };
}

/**
 * Description: Evaluate the sign-up password checklist live.
 * Input: The password and the username typed so far.
 * Output: Each requirement with whether it is met (same rules as the server).
 * Use case: The checklist under the sign-up password field.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function signupPasswordChecklist(password: string, username: string): PasswordCheck {
  return checkMasterPassword(password, username.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Registration review

/**
 * Description: Check the reason an administrator gives when rejecting a registration.
 * Input: The typed reason.
 * Output: The trimmed reason (3–500 characters), or the error message.
 * Use case: Reject confirmation dialogs (tenant and platform) and the service.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function validateRejectionReason(input: string): RuleResult<string> {
  const reason = input.trim();
  if (reason.length === 0) return fail("Enter the reason for the rejection.");
  if (reason.length < REJECTION_REASON_MIN_LENGTH) {
    return fail(`Use at least ${REJECTION_REASON_MIN_LENGTH} characters for the reason.`);
  }
  if (reason.length > REJECTION_REASON_MAX_LENGTH) {
    return fail(`Use at most ${REJECTION_REASON_MAX_LENGTH} characters for the reason.`);
  }
  return ok(reason);
}

/**
 * Description: Check the optional message of a rejected applicant's review request.
 * Input: The typed message (may be empty).
 * Output: The trimmed message, or null when empty; or the error message when too long.
 * Use case: The review request form and the service.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function validateReviewMessage(input: string): RuleResult<string | null> {
  const message = input.trim();
  if (message.length === 0) return ok(null);
  if (message.length > REVIEW_MESSAGE_MAX_LENGTH) {
    return fail(`Use at most ${REVIEW_MESSAGE_MAX_LENGTH} characters for the message.`);
  }
  return ok(message);
}

// ---------------------------------------------------------------------------
// Registrations list (search parameters of the registrations pages)

export const REGISTRATION_PAGE_SIZE         = 20;
export const REGISTRATION_MAX_PAGE          = 10_000;
export const REGISTRATION_SEARCH_MAX_LENGTH = 100;

/**
 * What the list shows. "active" and "suspended" are approved registrations
 * whose customer account is active or suspended.
 */
export type RegistrationFilter = "all" | "pending" | "active" | "suspended" | "rejected";

export const REGISTRATION_FILTERS: readonly { value: RegistrationFilter; label: string }[] = [
  { value: "all",       label: "All statuses" },
  { value: "pending",   label: "Pending" },
  { value: "active",    label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "rejected",  label: "Rejected" },
];

export type RegistrationListQuery = { q: string; status: RegistrationFilter; page: number };

/**
 * Description: Read one search parameter that may appear once, several times or not at all.
 * Input: The value Next.js gives for the parameter.
 * Output: The first value, or "" when missing.
 * Use case: parseRegistrationListQuery.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * Description: Read the registrations list's search, status and page from the URL.
 * Input: The page's search parameters (anyone can edit them).
 * Output: A valid query; bad values fall back to the defaults (never fails).
 * Use case: /tenant/registrations and /platform/tenants/<id>/registrations.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function parseRegistrationListQuery(
  searchParams: Record<string, string | string[] | undefined>,
): RegistrationListQuery {
  // Search text: trimmed and capped, so the database never gets a huge pattern.
  const q = firstValue(searchParams.q).trim().slice(0, REGISTRATION_SEARCH_MAX_LENGTH).trim();

  // Status: one of the known filters, otherwise "all".
  const statusText = firstValue(searchParams.status);
  const status     = REGISTRATION_FILTERS.find((filter) => filter.value === statusText)?.value ?? "all";

  // Page: a positive integer within bounds, otherwise 1.
  const pageText  = firstValue(searchParams.page);
  const page      = /^[0-9]{1,5}$/.test(pageText) ? Number(pageText) : NaN;
  const validPage = Number.isInteger(page) && page >= 1 && page <= REGISTRATION_MAX_PAGE;

  return { q, status, page: validPage ? page : 1 };
}

/**
 * Description: Check the filter a count-details popup asks for.
 * Input: An untrusted value from a Server Action argument.
 * Output: The filter, or null for anything unknown.
 * Use case: The count-details actions of both registrations pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function parseRegistrationFilter(value: unknown): RegistrationFilter | null {
  return REGISTRATION_FILTERS.find((filter) => filter.value === value)?.value ?? null;
}

/**
 * Description: Check a requested page number of a count-details popup.
 * Input: An untrusted value from a Server Action argument.
 * Output: The page (1 for anything invalid).
 * Use case: The count-details actions of both registrations pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function parseRegistrationPage(value: unknown): number {
  const page = typeof value === "number" ? value : NaN;
  return Number.isInteger(page) && page >= 1 && page <= REGISTRATION_MAX_PAGE ? page : 1;
}

/** The display state of one registration row. */
export type RegistrationDisplayStatus = "pending" | "review_requested" | "active" | "suspended" | "rejected";

export const REGISTRATION_STATUS_LABELS: Record<RegistrationDisplayStatus, string> = {
  pending:          "Pending",
  review_requested: "Review requested",
  active:           "Active",
  suspended:        "Suspended",
  rejected:         "Rejected",
};

/** One registration as the lists show it. Never the password hash. */
export type RegistrationRow = {
  id: string;
  fullName: string;
  email: string;
  username: string;
  accountType: AccountType;
  status: RegistrationDisplayStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  reviewRequestedAt: string | null;
  reviewRequestMessage: string | null;
};

/** One page of the registrations list. */
export type RegistrationPage = {
  rows: RegistrationRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
};

/** The registrations summary figures. */
export type RegistrationSummary = {
  pending: number;
  active: number;
  suspended: number;
  rejected: number;
  total: number;
};

/** What a review Server Action (approve, reject, suspend, reactivate) answers. */
export type RegistrationActionResult = { ok: true; message: string } | { ok: false; error: string };

/** What a count-details Server Action answers. */
export type RegistrationRecordsResult = { ok: true; page: RegistrationPage } | { ok: false; error: string };

/**
 * Tenant field rules (docs/tenant-management.md §4, §8.2, §8.3).
 *
 * The server applies these as the source of truth; client components import
 * the same functions for instant feedback. So this module must stay pure: no
 * `server-only`, no `node:` imports, no environment access (callers pass in
 * whatever configuration a rule needs).
 */
import {
  isValidUsername,
  normalizeUsername,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "@/lib/platform-auth/username";

export type RuleResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Description: Wrap a valid, normalized value in a successful rule result.
 * Input: The value the rule accepted (already normalized).
 * Output: `{ ok: true, value }`.
 * Use case: Every validator in this module, so all of them return the same shape.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function ok<T>(value: T): RuleResult<T> {
  return { ok: true, value };
}

/**
 * Description: Wrap a user-facing error message in a failed rule result.
 * Input: The message shown under the field.
 * Output: `{ ok: false, error }`.
 * Use case: Every validator in this module, so all of them return the same shape.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function fail<T>(error: string): RuleResult<T> {
  return { ok: false, error };
}

// Matches every C0/C1 control character, including NUL, tab and newline.
const CONTROL_CHARACTER = /\p{Cc}/u;

// ---------------------------------------------------------------------------
// Full name

export const FULL_NAME_MIN_LENGTH = 2;
export const FULL_NAME_MAX_LENGTH = 200;

// Business rule (confirmed by the owner, 2026-10-15): a tenant's full name
// holds letters of any script (\p{L}, with combining marks \p{M} for scripts
// such as Hindi), spaces and the separators . ' - & only. No digits.
const FULL_NAME_PATTERN = /^[\p{L}\p{M} .'&-]+$/u;
// The text shown when the pattern does not match; also used by the form hint.
export const FULL_NAME_ALLOWED_TEXT = "letters, spaces and . ' - & (no digits)";

/**
 * Description: Bring a typed full name into its stored form.
 * Input: The raw text from the form.
 * Output: The text trimmed, with every run of whitespace collapsed to one space.
 * Use case: Validation (create, edit, preview) and the value written to the database.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function normalizeFullName(input: string): string {
  // \s covers tabs and newlines too, so a pasted multi-line name becomes one line.
  return input.trim().replace(/\s+/g, " ");
}

/**
 * Description: Check a tenant's full name against the business rules.
 * Input: The raw text from the form (trimmed and collapsed here).
 * Output: The normalized name, or the message for the first broken rule.
 * Use case: Create and edit forms (client feedback) and the tenant services (authoritative).
 *   Rules, in order: required; no control characters; only letters, spaces
 *   and . ' - &; 2–200 characters.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function validateFullName(input: string): RuleResult<string> {
  // Step 1: the stored form decides the length and the characters.
  const name = normalizeFullName(input);

  // Step 2: required; a whitespace-only entry is empty after trimming.
  if (name.length === 0) return fail("Enter the tenant's full name.");

  // Step 3: control characters (pasted from elsewhere) are never part of a name.
  if (CONTROL_CHARACTER.test(name)) return fail("Remove the control characters from the name.");

  // Step 4: letters, spaces and the allowed separators only (no digits).
  if (!FULL_NAME_PATTERN.test(name)) return fail(`Use only ${FULL_NAME_ALLOWED_TEXT} in the name.`);

  // Step 5: the length limits of the database column and the business rule.
  if (name.length < FULL_NAME_MIN_LENGTH || name.length > FULL_NAME_MAX_LENGTH) {
    return fail(`Use ${FULL_NAME_MIN_LENGTH}–${FULL_NAME_MAX_LENGTH} characters for the name.`);
  }
  return ok(name);
}

// ---------------------------------------------------------------------------
// Phone (optional): an Indian mobile number

// Business rule (confirmed by the owner, 2026-10-15): exactly 10 digits,
// starting with 6, 7, 8 or 9 (Indian mobile numbering). Stored as the 10 digits.
export const PHONE_LENGTH     = 10;
export const PHONE_MAX_LENGTH = PHONE_LENGTH;
const INDIAN_MOBILE_PATTERN   = /^[6-9][0-9]{9}$/;
// Prefixes people paste in front of the 10 digits: the country code 91 and a trunk 0.
const COUNTRY_CODE = "91";
const TRUNK_PREFIX = "0";
const PHONE_ERROR  = "Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.";

/**
 * Description: Keep only what a mobile number field may contain while the owner types or pastes.
 * Input: The raw text of the field (typed or pasted).
 * Output: At most 10 digits. Letters, spaces, "+", "-" and brackets are removed;
 *   a pasted "+91 98765 43210" or "098765 43210" keeps the 10-digit number.
 * Use case: onChange of the Phone inputs (create and edit): letters and other
 *   characters are blocked instead of being shown and rejected later.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function sanitizeIndianMobileInput(input: string): string {
  // Step 1: digits only; everything else cannot be part of the number.
  let digits = input.replace(/[^0-9]/g, "");

  // Step 2: a pasted country code or trunk prefix in front of a full number is dropped.
  if (digits.length > PHONE_LENGTH && digits.startsWith(COUNTRY_CODE)) {
    digits = digits.slice(COUNTRY_CODE.length);
  } else if (digits.length > PHONE_LENGTH && digits.startsWith(TRUNK_PREFIX)) {
    digits = digits.slice(TRUNK_PREFIX.length);
  }

  // Step 3: never more than the 10 digits of a mobile number.
  return digits.slice(0, PHONE_LENGTH);
}

/**
 * Description: Check the optional phone number against the Indian mobile rule.
 * Input: The raw text from the form.
 * Output: null for an empty field (the phone is optional), the 10 digits when
 *   valid, otherwise the error message.
 * Use case: Create and edit forms (client feedback) and the tenant services
 *   (authoritative). The server does not reformat: it accepts exactly 10 digits.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function validatePhone(input: string): RuleResult<string | null> {
  // Step 1: surrounding whitespace carries no meaning.
  const phone = input.trim();

  // Step 2: optional: an empty field is stored as null.
  if (phone.length === 0) return ok(null);

  // Step 3: exactly 10 digits, first digit 6–9.
  if (!INDIAN_MOBILE_PATTERN.test(phone)) return fail(PHONE_ERROR);
  return ok(phone);
}

// ---------------------------------------------------------------------------
// Email

export const EMAIL_MAX_LENGTH = 320;
const EMAIL_LOCAL_MAX_LENGTH  = 64;
const EMAIL_DOMAIN_MAX_LENGTH = 253;
// The RFC 5322 "atext" characters plus dots. Quoted local parts are not
// accepted: nobody needs them and they complicate every later use of the address.
const EMAIL_LOCAL_PATTERN = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const DNS_LABEL_PATTERN   = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Description: Bring a typed email address into its stored form.
 * Input: The raw text from the form.
 * Output: The address trimmed and lower-cased (the database requires lower case).
 * Use case: Validation and uniqueness checks of the tenant admin email.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Description: Check the tenant admin's email address.
 * Input: The raw text from the form.
 * Output: The normalized address, or the message for the first broken rule.
 * Use case: Create and edit forms and the tenant services. Rules: required;
 *   at most 320 characters; one "@"; a 1–64 character local part without
 *   leading, trailing or doubled dots; a domain of valid DNS labels with a dot.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function validateEmail(input: string): RuleResult<string> {
  const email = normalizeEmail(input);
  if (email.length === 0) return fail("Enter an email address.");
  if (email.length > EMAIL_MAX_LENGTH) {
    return fail(`Use an email address of at most ${EMAIL_MAX_LENGTH} characters.`);
  }

  // Exactly one "@" splits the address into its two parts.
  const parts = email.split("@");
  if (parts.length !== 2) return fail("Enter an email address like name@example.com.");
  const [local = "", domain = ""] = parts;

  // The part before the "@".
  if (
    local.length === 0 ||
    local.length > EMAIL_LOCAL_MAX_LENGTH ||
    !EMAIL_LOCAL_PATTERN.test(local) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..")
  ) {
    return fail(
      "Check the part before the @: use 1–64 characters without spaces, and no dot at the start, at the end or twice in a row.",
    );
  }

  // The part after the "@": at least two valid DNS labels.
  const labels = domain.split(".");
  if (
    domain.length > EMAIL_DOMAIN_MAX_LENGTH ||
    labels.length < 2 ||
    !labels.every((label) => DNS_LABEL_PATTERN.test(label))
  ) {
    return fail("Check the part after the @: it must be a domain such as example.com.");
  }
  return ok(email);
}

// ---------------------------------------------------------------------------
// Tenant admin user name

export const TENANT_USERNAME_MIN_LENGTH = USERNAME_MIN_LENGTH;
export const TENANT_USERNAME_MAX_LENGTH = USERNAME_MAX_LENGTH;

/**
 * Description: Check the tenant admin's user name (same rule as platform owners).
 * Input: The raw text from the form.
 * Output: The normalized (trimmed, lower-case) name, or the error message.
 * Use case: Create (Manual login section) and edit forms and the tenant services.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function validateTenantUsername(input: string): RuleResult<string> {
  const username = normalizeUsername(input);
  if (username.length === 0) return fail("Enter a user name.");
  if (!isValidUsername(username)) {
    return fail(
      `Use ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} characters: lower-case letters, digits, dots, hyphens or underscores, starting and ending with a letter or digit.`,
    );
  }
  return ok(username);
}

// ---------------------------------------------------------------------------
// Master password (the tenant admin's login password)

export const MASTER_PASSWORD_MIN_LENGTH = 12;
// Equal to PASSWORD_MAX_LENGTH in platform-auth/password.ts, which hashes it.
// That module needs node:crypto, so the number is repeated here (a test keeps them equal).
export const MASTER_PASSWORD_MAX_LENGTH = 256;
const MASTER_PASSWORD_MIN_CLASSES       = 2;

export type PasswordRequirement = { id: string; label: string; met: boolean };
export type PasswordCheck = { valid: boolean; requirements: PasswordRequirement[] };

/**
 * Description: Count how many character classes a password uses.
 * Input: The password.
 * Output: 0–4: lower-case letters, upper-case letters, digits, other symbols.
 * Use case: The "variety" requirement of the master password.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function characterClassCount(password: string): number {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/];
  return classes.filter((pattern) => pattern.test(password)).length;
}

/**
 * Description: Evaluate every master-password requirement for a live checklist.
 * Input: The password (never trimmed: spaces are part of it) and the user name.
 * Output: Whether all requirements are met, and each requirement with its state.
 * Use case: The password checklist under the master password fields and validateMasterPassword.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function checkMasterPassword(password: string, username: string): PasswordCheck {
  const name = normalizeUsername(username);
  const requirements: PasswordRequirement[] = [
    {
      id: "length",
      label: `${MASTER_PASSWORD_MIN_LENGTH}–${MASTER_PASSWORD_MAX_LENGTH} characters`,
      met:
        password.length >= MASTER_PASSWORD_MIN_LENGTH &&
        password.length <= MASTER_PASSWORD_MAX_LENGTH,
    },
    {
      id: "variety",
      label: "At least 2 of: lower-case letter, upper-case letter, digit, symbol",
      met: characterClassCount(password) >= MASTER_PASSWORD_MIN_CLASSES,
    },
    {
      id: "username",
      label: "Does not contain the user name",
      // Without a user name yet there is nothing to compare against.
      met: name.length === 0 || !password.toLowerCase().includes(name),
    },
  ];
  return { valid: requirements.every((r) => r.met), requirements };
}

/**
 * Description: Check a master password and return the message for the first unmet requirement.
 * Input: The password and the user name it must not contain.
 * Output: The password unchanged, or the error message.
 * Use case: Create (Manual login section), Reset master password, and the tenant services.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function validateMasterPassword(password: string, username: string): RuleResult<string> {
  if (password.length === 0) return fail("Enter a password.");
  const unmet = checkMasterPassword(password, username).requirements.find((r) => !r.met);
  if (!unmet) return ok(password);
  switch (unmet.id) {
    case "length":
      return fail(
        `Use ${MASTER_PASSWORD_MIN_LENGTH}–${MASTER_PASSWORD_MAX_LENGTH} characters for the password.`,
      );
    case "variety":
      return fail(
        "Mix at least 2 of: lower-case letters, upper-case letters, digits and symbols.",
      );
    default:
      return fail("Choose a password that does not contain the user name.");
  }
}

// ---------------------------------------------------------------------------
// Database name and user

// PostgreSQL truncates identifiers to 63 bytes; the pattern is ASCII-only, so
// characters equal bytes.
export const DATABASE_IDENTIFIER_MAX_LENGTH = 63;
const DATABASE_IDENTIFIER_PATTERN           = /^[a-z_][a-z0-9_]{0,62}$/;
const ALWAYS_RESERVED_IDENTIFIERS = [
  "postgres",
  "template0",
  "template1",
  "public",
  "none",
  "current_user",
  "session_user",
  "current_role",
];

export type DatabaseIdentifierKind = "database" | "user";

/**
 * Description: Check a database name or database user name.
 * Input: The raw text, whether it is a database or a user, and the names only
 *   the server knows (`ctx.reservedNames`: the control-plane database and the
 *   administrative login, POSTGRES_USER).
 * Output: The trimmed identifier, or the error message.
 * Use case: Create (Manual database section), Test connection and the tenant services.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function validateDatabaseIdentifier(
  input: string,
  kind: DatabaseIdentifierKind,
  ctx: { reservedNames: readonly string[] },
): RuleResult<string> {
  const what  = kind === "database" ? "database name" : "database user";
  const value = input.trim();
  if (value.length === 0) return fail(`Enter a ${what}.`);
  // No case folding: PostgreSQL folds unquoted names, and a name that only
  // works quoted is a trap for whoever administers the database later.
  if (!DATABASE_IDENTIFIER_PATTERN.test(value)) {
    return fail(
      `Use 1–${DATABASE_IDENTIFIER_MAX_LENGTH} characters for the ${what}: lower-case letters, digits or underscores, not starting with a digit.`,
    );
  }
  if (value.startsWith("pg_")) {
    return fail(`Choose a ${what} that does not start with pg_ (reserved by PostgreSQL).`);
  }
  const reserved = [...ALWAYS_RESERVED_IDENTIFIERS, ...ctx.reservedNames.map((n) => n.toLowerCase())];
  if (reserved.includes(value)) return fail(`${value} is reserved. Choose another ${what}.`);
  return ok(value);
}

// ---------------------------------------------------------------------------
// Database passwords

export const NEW_DATABASE_PASSWORD_MIN_LENGTH = 16;
export const DATABASE_PASSWORD_MAX_LENGTH     = 128;
// Printable ASCII without the space: survives every client, shell and config
// file, and is the range where SASLprep is the identity (see provisioning/scram.ts).
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

/**
 * Description: Check a password for a database role this application creates.
 * Input: The password (never trimmed).
 * Output: The password unchanged, or the error message.
 * Use case: Create (Manual database section, new database) and Rotate database password.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function validateNewDatabasePassword(password: string): RuleResult<string> {
  if (
    password.length < NEW_DATABASE_PASSWORD_MIN_LENGTH ||
    password.length > DATABASE_PASSWORD_MAX_LENGTH
  ) {
    return fail(
      `Use ${NEW_DATABASE_PASSWORD_MIN_LENGTH}–${DATABASE_PASSWORD_MAX_LENGTH} characters for the database password.`,
    );
  }
  if (!PRINTABLE_ASCII.test(password)) {
    return fail("Use only printable ASCII characters (no spaces) in the database password.");
  }
  return ok(password);
}

/**
 * Description: Check the password of a database role that already exists.
 * Input: The password (never trimmed; whatever it is, as long as it can be sent).
 * Output: The password unchanged, or the error message.
 * Use case: Create with an existing database, Test connection and Update database password.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function validateExistingDatabasePassword(password: string): RuleResult<string> {
  if (password.length === 0) return fail("Enter the database password.");
  if (password.length > DATABASE_PASSWORD_MAX_LENGTH) {
    return fail(`Use at most ${DATABASE_PASSWORD_MAX_LENGTH} characters for the database password.`);
  }
  // The wire protocol uses NUL as a string terminator.
  if (password.includes("\0")) return fail("Remove the NUL character from the database password.");
  return ok(password);
}

// ---------------------------------------------------------------------------
// Database port

export const PORT_MIN = 1;
export const PORT_MAX = 65535;

/**
 * Description: Parse a database port; an empty input means the configured default.
 * Input: The typed text (or a number) and the fallback (POSTGRES_PORT).
 * Output: The port 1–65535, or the error message.
 * Use case: Create (Manual database section) and Test connection.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function parsePort(
  input: string | number | null | undefined,
  fallback: number,
): RuleResult<number> {
  const text = typeof input === "number" ? String(input) : (input ?? "").trim();
  if (text.length === 0) return ok(fallback);
  // Digits only: Number() would also accept "1e3", "0x50" and " 5 ".
  const port = /^[0-9]{1,5}$/.test(text) ? Number(text) : NaN;
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    return fail(`Use a whole number from ${PORT_MIN} to ${PORT_MAX} for the port.`);
  }
  return ok(port);
}

// ---------------------------------------------------------------------------
// Suspension reason

export const SUSPENSION_REASON_MAX_LENGTH = 500;

/**
 * Description: Check the reason the owner gives when suspending a tenant.
 * Input: The typed reason.
 * Output: The trimmed reason (1–500 characters), or the error message.
 * Use case: The Suspend confirmation dialog and the suspendTenant service.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function validateSuspensionReason(input: string): RuleResult<string> {
  const reason = input.trim();
  if (reason.length === 0) return fail("Enter the reason for the suspension.");
  if (reason.length > SUSPENSION_REASON_MAX_LENGTH) {
    return fail(`Use at most ${SUSPENSION_REASON_MAX_LENGTH} characters for the reason.`);
  }
  return ok(reason);
}

// ---------------------------------------------------------------------------
// Tenant list query (search parameters of /platform/tenants)

export const TENANT_LIST_PAGE_SIZE    = 20;
export const TENANT_LIST_MAX_PAGE     = 10_000;
export const TENANT_SEARCH_MAX_LENGTH = 100;

export type TenantListStatusFilter = "all" | "active" | "suspended" | "pending" | "failed";
export const TENANT_LIST_STATUS_FILTERS: readonly TenantListStatusFilter[] = [
  "all",
  "active",
  "suspended",
  "pending",
  "failed",
];

export type TenantListQuery = { q: string; status: TenantListStatusFilter; page: number };

/**
 * Description: Read one search parameter that may appear once, several times or not at all.
 * Input: The value Next.js gives for the parameter.
 * Output: The first value, or "" when missing.
 * Use case: parseTenantListQuery.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * Description: Read the directory's search, status and page from the URL.
 * Input: The page's search parameters (anyone can edit them).
 * Output: A valid query; bad values fall back to the defaults (never fails).
 * Use case: The tenant directory page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function parseTenantListQuery(
  searchParams: Record<string, string | string[] | undefined>,
): TenantListQuery {
  const q = firstValue(searchParams.q).trim().slice(0, TENANT_SEARCH_MAX_LENGTH).trim();

  const statusText = firstValue(searchParams.status);
  const status     = TENANT_LIST_STATUS_FILTERS.find((s) => s === statusText) ?? "all";

  const pageText  = firstValue(searchParams.page);
  const page      = /^[0-9]{1,5}$/.test(pageText) ? Number(pageText) : NaN;
  const validPage = Number.isInteger(page) && page >= 1 && page <= TENANT_LIST_MAX_PAGE;

  return { q, status, page: validPage ? page : 1 };
}

/**
 * Description: Escape the wildcard characters of a search text for SQL LIKE.
 * Input: The search text.
 * Output: The text with \, % and _ escaped, for `ILIKE ... ESCAPE '\'`.
 * Use case: The directory search, so the text matches literally.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Count details (the records behind a summary figure)

/**
 * The tenant groups a summary figure stands for. "setup" is the "Pending
 * setup" figure: pending + provisioning + failed.
 */
export type TenantCountCategory = "all" | "active" | "suspended" | "setup" | "failed";
export const TENANT_COUNT_CATEGORIES: readonly TenantCountCategory[] = [
  "all",
  "active",
  "suspended",
  "setup",
  "failed",
];

/**
 * Which tenants a count-details dialog lists: a summary figure, or the
 * directory's current result total (its search and status filter).
 */
export type TenantCountSource =
  | { kind: "summary"; category: TenantCountCategory }
  | { kind: "list"; q: string; status: TenantListStatusFilter };

/**
 * Description: Validate the "which tenants" argument of the count-details Server Action.
 * Input: Anything (a Server Action argument is untrusted).
 * Output: A valid source, or null when the value has any other shape.
 * Use case: loadTenantCountRecordsAction, before the database is queried.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function parseTenantCountSource(value: unknown): TenantCountSource | null {
  // Step 1: a plain object only.
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  // Step 2: a summary figure names one of the fixed categories.
  if (record.kind === "summary") {
    const category = TENANT_COUNT_CATEGORIES.find((item) => item === record.category);
    return category ? { kind: "summary", category } : null;
  }

  // Step 3: the directory total carries the same search and status as the URL.
  if (record.kind === "list") {
    const status = TENANT_LIST_STATUS_FILTERS.find((item) => item === record.status);
    if (!status || typeof record.q !== "string") return null;
    const q = record.q.trim().slice(0, TENANT_SEARCH_MAX_LENGTH).trim();
    return { kind: "list", q, status };
  }
  return null;
}

/**
 * Description: Validate the page number argument of the count-details Server Action.
 * Input: Anything (a Server Action argument is untrusted).
 * Output: A whole page number from 1 to TENANT_LIST_MAX_PAGE; anything else gives 1.
 * Use case: loadTenantCountRecordsAction.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function parseTenantCountPage(value: unknown): number {
  const valid = typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= TENANT_LIST_MAX_PAGE;
  return valid ? value : 1;
}

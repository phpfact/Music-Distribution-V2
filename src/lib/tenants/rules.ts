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

function ok<T>(value: T): RuleResult<T> {
  return { ok: true, value };
}

function fail<T>(error: string): RuleResult<T> {
  return { ok: false, error };
}

// Matches every C0/C1 control character, including NUL, tab and newline.
const CONTROL_CHARACTER = /\p{Cc}/u;

// ---------------------------------------------------------------------------
// Full name

export const FULL_NAME_MIN_LENGTH = 2;
export const FULL_NAME_MAX_LENGTH = 200;

export function normalizeFullName(input: string): string {
  // \s covers tabs and newlines too, so a pasted multi-line name becomes one line.
  return input.trim().replace(/\s+/g, " ");
}

export function validateFullName(input: string): RuleResult<string> {
  const name = normalizeFullName(input);
  if (name.length === 0) return fail("Enter the tenant's full name.");
  if (CONTROL_CHARACTER.test(name)) return fail("Remove the control characters from the name.");
  if (name.length < FULL_NAME_MIN_LENGTH || name.length > FULL_NAME_MAX_LENGTH) {
    return fail(`Use ${FULL_NAME_MIN_LENGTH}–${FULL_NAME_MAX_LENGTH} characters for the name.`);
  }
  return ok(name);
}

// ---------------------------------------------------------------------------
// Phone (optional)

// Room for a formatted number such as "+44 (020) 7946-0958 ...". The digits
// themselves are limited by the pattern below.
export const PHONE_MAX_LENGTH = 32;
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

/** Empty input is fine: the phone number is optional and is then stored as null. */
export function validatePhone(input: string): RuleResult<string | null> {
  if (input.trim().length === 0) return ok(null);
  if (input.length > PHONE_MAX_LENGTH) {
    return fail("Use 7–15 digits, optionally starting with +.");
  }
  // Common formatting characters carry no information; the stored form is digits only.
  const phone = input.replace(/[\s\-.()]/g, "");
  if (!PHONE_PATTERN.test(phone)) {
    return fail("Use 7–15 digits, optionally starting with +.");
  }
  return ok(phone);
}

// ---------------------------------------------------------------------------
// Email

export const EMAIL_MAX_LENGTH = 320;
const EMAIL_LOCAL_MAX_LENGTH = 64;
const EMAIL_DOMAIN_MAX_LENGTH = 253;
// The RFC 5322 "atext" characters plus dots. Quoted local parts are not
// accepted: nobody needs them and they complicate every later use of the address.
const EMAIL_LOCAL_PATTERN = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const DNS_LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function validateEmail(input: string): RuleResult<string> {
  const email = normalizeEmail(input);
  if (email.length === 0) return fail("Enter an email address.");
  if (email.length > EMAIL_MAX_LENGTH) {
    return fail(`Use an email address of at most ${EMAIL_MAX_LENGTH} characters.`);
  }
  const parts = email.split("@");
  if (parts.length !== 2) return fail("Enter an email address like name@example.com.");
  const [local = "", domain = ""] = parts;
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
const MASTER_PASSWORD_MIN_CLASSES = 2;

export type PasswordRequirement = { id: string; label: string; met: boolean };
export type PasswordCheck = { valid: boolean; requirements: PasswordRequirement[] };

function characterClassCount(password: string): number {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/];
  return classes.filter((pattern) => pattern.test(password)).length;
}

/**
 * Every requirement with whether it is met, for a live checklist. The password
 * is never trimmed: leading or trailing spaces are part of it.
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
const DATABASE_IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
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
 * `ctx.reservedNames` holds the names only the server knows: the control-plane
 * database name and the administrative login (POSTGRES_USER).
 */
export function validateDatabaseIdentifier(
  input: string,
  kind: DatabaseIdentifierKind,
  ctx: { reservedNames: readonly string[] },
): RuleResult<string> {
  const what = kind === "database" ? "database name" : "database user";
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
export const DATABASE_PASSWORD_MAX_LENGTH = 128;
// Printable ASCII without the space: survives every client, shell and config
// file, and is the range where SASLprep is the identity (see provisioning/scram.ts).
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

/** A password for a role this application creates. */
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

/** The password of a role that already exists: whatever it is, as long as it can be sent. */
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

/** Empty input means the default (POSTGRES_PORT, passed in by the caller). */
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

export const TENANT_LIST_PAGE_SIZE = 20;
export const TENANT_LIST_MAX_PAGE = 10_000;
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

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Never fails: the values come from a URL anyone can edit, so bad ones fall back to defaults. */
export function parseTenantListQuery(
  searchParams: Record<string, string | string[] | undefined>,
): TenantListQuery {
  const q = firstValue(searchParams.q).trim().slice(0, TENANT_SEARCH_MAX_LENGTH).trim();

  const statusText = firstValue(searchParams.status);
  const status = TENANT_LIST_STATUS_FILTERS.find((s) => s === statusText) ?? "all";

  const pageText = firstValue(searchParams.page);
  const page = /^[0-9]{1,5}$/.test(pageText) ? Number(pageText) : NaN;
  const validPage = Number.isInteger(page) && page >= 1 && page <= TENANT_LIST_MAX_PAGE;

  return { q, status, page: validPage ? page : 1 };
}

/** For `ILIKE ... ESCAPE '\'`: the search text matches literally. */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}

import "server-only";
import { redactLogCredentials, sanitizeLogMessage } from "@/lib/log-sanitizer";
/**
 * Provisioning errors (docs/tenant-management.md §6.1).
 *
 * Two audiences: `safeMessage` is shown to the platform owner and stored in
 * the run and tenant rows, so it is built from fixed text plus names that are
 * not secret (database, role, port). The underlying error goes to the server
 * log only, through `describeForLog`, which removes anything credential-like.
 */

export type ProvisioningErrorCode =
  | "auth_failed"
  | "database_missing"
  | "unreachable"
  | "permission_denied"
  | "resource_conflict"
  | "schema_mismatch"
  | "admin_conflict"
  | "dns"
  | "invalid_state"
  | "already_running"
  | "interrupted"
  | "internal";

/** Both `tenant_provisioning_runs.error_message` and `tenants.status_reason` are VARCHAR(500). */
export const SAFE_MESSAGE_MAX_LENGTH = 500;

// Causes that can go away by themselves, so a retry without changing anything
// may succeed. The others need someone to fix something first.
const TRANSIENT_CODES: ReadonlySet<ProvisioningErrorCode> = new Set([
  "unreachable",
  "dns",
  "already_running",
  "interrupted",
  "internal",
]);

/**
 * Description: Fit a safe message into its stored length.
 * Input: The text.
 * Output: The text, cut with an ellipsis when longer than SAFE_MESSAGE_MAX_LENGTH.
 * Use case: ProvisioningError construction.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function clip(text: string): string {
  return text.length <= SAFE_MESSAGE_MAX_LENGTH
    ? text
    : `${text.slice(0, SAFE_MESSAGE_MAX_LENGTH - 1)}…`;
}

export class ProvisioningError extends Error {
  readonly safeMessage: string;
  /** Whether retrying without changing anything else can succeed. */
  readonly retryable: boolean;

  constructor(
    readonly code: ProvisioningErrorCode,
    safeMessage: string,
    options: { cause?: unknown; retryable?: boolean } = {},
  ) {
    const message = clip(safeMessage);
    super(message, { cause: options.cause });
    this.name = "ProvisioningError";
    this.safeMessage = message;
    this.retryable = options.retryable ?? TRANSIENT_CODES.has(code);
  }
}

// ---------------------------------------------------------------------------
// Classifying pg / network errors

// Socket-level failures: the server could not be reached at all.
const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "EPIPE",
]);
// Server states that refuse new work: shutting down, starting up, full.
const UNAVAILABLE_SQLSTATES = new Set(["57P01", "57P02", "57P03", "53300"]);
const SQLSTATE_PATTERN      = /^[0-9A-Z]{5}$/;

/**
 * Description: Read the code of a thrown error (errno or SQLSTATE).
 * Input: Any thrown value.
 * Output: The code text, or undefined.
 * Use case: sqlState, classifyError and describeForLog.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/**
 * Description: Read the SQLSTATE of a PostgreSQL error.
 * Input: Any thrown value.
 * Output: The five-character SQLSTATE, or undefined for network and other errors.
 * Use case: Error classification and unique-violation handling.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function sqlState(error: unknown): string | undefined {
  const code = errorCode(error);
  return code && !NETWORK_CODES.has(code) && SQLSTATE_PATTERN.test(code) ? code : undefined;
}

/**
 * Description: Classify an error into a provisioning error code.
 * Input: Any thrown value.
 * Output: unreachable, auth_failed, database_missing, permission_denied,
 *   resource_conflict or internal (from errno codes, SQLSTATEs and pg's own messages).
 * Use case: connectionError, stepError and migration failures.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function classifyError(error: unknown): ProvisioningErrorCode {
  if (error instanceof ProvisioningError) return error.code;
  const code = errorCode(error);
  if (code && NETWORK_CODES.has(code)) return "unreachable";
  const state = sqlState(error);
  if (state) {
    if (state === "28P01" || state === "28000") return "auth_failed";
    if (state === "3D000") return "database_missing";
    if (state === "42501") return "permission_denied";
    if (state === "42P04" || state === "42710") return "resource_conflict";
    if (state.startsWith("08") || UNAVAILABLE_SQLSTATES.has(state)) return "unreachable";
    return "internal";
  }
  // pg reports its own connect timeout and a dropped socket without a code.
  const message = error instanceof Error ? error.message : "";
  if (/connection timeout|timeout expired|Connection terminated/i.test(message)) {
    return "unreachable";
  }
  return "internal";
}

// ---------------------------------------------------------------------------
// Safe messages

export type ConnectionContext = {
  /** Which login was used: the platform's administrative one or a tenant's. */
  login: "admin" | "tenant";
  host: string;
  user: string;
  database: string;
  port: number;
};

/**
 * Description: Describe which login a failed connection used.
 * Input: The connection context.
 * Output: "the platform's administrative login (…)" or "the database user …".
 * Use case: connectionError messages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function whoConnects(context: ConnectionContext): string {
  return context.login === "admin"
    ? `the platform's administrative login ("${context.user}")`
    : `the database user "${context.user}"`;
}

/**
 * Description: Explain a failed connection attempt without the error's own text.
 * Input: The error and the connection context.
 * Output: A ProvisioningError with a message telling the owner what to check.
 * Use case: connect (admin.ts).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function connectionError(error: unknown, context: ConnectionContext): ProvisioningError {
  if (error instanceof ProvisioningError) return error;
  const code    = classifyError(error);
  const who     = whoConnects(context);
  const where   = `database "${context.database}"`;
  const options = { cause: error };
  switch (code) {
    case "auth_failed":
      return new ProvisioningError(
        code,
        `PostgreSQL rejected the sign-in of ${who} to ${where}: the password is wrong, or the role does not exist or cannot log in. Check the credentials, then retry.`,
        options,
      );
    case "database_missing":
      return new ProvisioningError(
        code,
        `The ${where} does not exist on the PostgreSQL server at port ${context.port}.`,
        options,
      );
    case "permission_denied":
      return new ProvisioningError(
        code,
        `${capitalize(who)} is not allowed to connect to ${where}. Grant it CONNECT on that database, then retry.`,
        options,
      );
    case "unreachable":
      return new ProvisioningError(
        code,
        `The PostgreSQL server at ${context.host}:${context.port} could not be reached. Check that it is running and that the port is right, then retry.`,
        options,
      );
    default:
      return new ProvisioningError(
        "internal",
        `Connecting to ${where} as ${who} failed unexpectedly. Retry; if it fails again, check the server log.`,
        options,
      );
  }
}

/**
 * Description: Wrap an error raised while a provisioning step was running.
 * Input: The error and what the step was doing.
 * Output: The ProvisioningError as is, or a new one with a generic message naming
 *   the activity (the details go to the log).
 * Use case: Every provisioning step.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function stepError(error: unknown, activity: string): ProvisioningError {
  if (error instanceof ProvisioningError) return error;
  const code    = classifyError(error);
  const options = { cause: error };
  switch (code) {
    case "unreachable":
      return new ProvisioningError(
        code,
        `The connection to PostgreSQL was lost while ${activity}. Retry setup.`,
        options,
      );
    case "permission_denied":
      return new ProvisioningError(
        code,
        `PostgreSQL refused a privilege needed for ${activity}. Check the privileges of the platform's administrative login, then retry.`,
        options,
      );
    case "resource_conflict":
      return new ProvisioningError(
        code,
        `An object needed for ${activity} already exists and was left untouched. Resolve the clash on the database server, then retry.`,
        options,
      );
    case "auth_failed":
    case "database_missing":
      return new ProvisioningError(
        code,
        `PostgreSQL could not be used for ${activity} (${code === "auth_failed" ? "sign-in rejected" : "database missing"}). Check the tenant's database settings, then retry.`,
        options,
      );
    default:
      return new ProvisioningError(
        "internal",
        `Setup failed while ${activity} because of an unexpected error. Retry setup; if it fails again, check the server log.`,
        options,
      );
  }
}

/**
 * Description: Upper-case the first character of a text.
 * Input: The text.
 * Output: The text with its first character upper-cased.
 * Use case: stepError messages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// Log redaction

/**
 * Description: Remove credentials from a text meant for the log.
 * Input: The text and known secret values.
 * Output: The text without connection strings, password-like values, verifiers,
 *   hashes and every given secret (longest first).
 * Use case: describeForLog and the runner's log lines.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function redact(text: string, secrets: readonly string[] = []): string {
  return sanitizeLogMessage(text, secrets);
}

/**
 * Description: Describe an error and its cause chain on one redacted log line.
 * Input: The error and known secret values.
 * Output: The error's message with its code, then the causes (bounded walk), all redacted.
 * Use case: The runner and step error logging.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function describeForLog(error: unknown, secrets: readonly string[] = []): string {
  const parts: string[] = [];
  let current: unknown  = error;
  // A bounded walk: a cause chain could in theory be cyclic.
  for (let depth = 0; current !== undefined && current !== null && depth < 4; depth += 1) {
    const message = redactLogCredentials(current instanceof Error ? current.message : String(current), secrets);
    const lines = message
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    // Prisma puts the cause on the last line of a multi-line message.
    const line = (lines.length > 1 ? lines.at(-1) : lines[0]) ?? "unknown error";
    const code = errorCode(current);
    parts.push(code ? `[${code}] ${line}` : line);
    current = current instanceof Error ? current.cause : undefined;
  }
  return redact(parts.join(" <- caused by: "), secrets);
}

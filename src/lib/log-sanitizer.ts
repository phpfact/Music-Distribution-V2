/** Shared, dependency-free credential redaction for server diagnostic messages. */
export const MAX_LOG_MESSAGE_LENGTH = 2_000;

const REDACTIONS: [RegExp, string][] = [
  // A URI can hold credentials in its authority, path or query string.
  [/\b(?:postgres(?:ql)?|redis(?:s)?|https?):\/\/[^\s<>"']+/gi, "<connection string>"],
  [/SCRAM-SHA-256\$[^\s'"<>]+/gi, "<scram verifier>"],
  [/\$argon2(?:id|i|d)\$[^\s'"<>]+/gi, "<password hash>"],
  [/\bPASSWORD\s+(?:E|U&)?'(?:\\.|[^']|'')*'/gi, "PASSWORD '<redacted>'"],
  [/\bPASSWORD\s+(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)[\s\S]*?\1/gi, "PASSWORD '<redacted>'"],
  // Headers contain compound values; consume the whole line before assignments.
  [/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]+/gi, "<credential header>"],
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi, "<authorization>"],
  // Match quoted JSON keys and camel/snake/kebab names such as accessToken,
  // database_password and x-api-key, as well as plain password/token assignments.
  [/(["']?\b[\w-]*(?:password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie)[\w-]*["']?\s*[=:]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}&]+)/gi, "$1<redacted>"],
];

/**
 * Description: Redact complete credential values before selecting diagnostic lines.
 * Input: Diagnostic text and optional known secrets that must never be logged.
 * Output: Redacted text with line boundaries intact; not yet a bounded log line.
 * Use case: Prisma last-line extraction without leaking multiline quoted secrets.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export function redactLogCredentials(text: string, secrets: readonly string[] = []): string {
  let result = text;
  // Replace complete secrets before truncation, including overlapping values.
  const ordered = [...secrets].filter((secret) => secret.length > 0).sort((a, b) => b.length - a.length);
  for (const secret of ordered) result = result.split(secret).join("<redacted>");
  for (const [pattern, replacement] of REDACTIONS) result = result.replace(pattern, replacement);
  return result;
}

/**
 * Description: Remove credentials, flatten controls and bound a server log message.
 * Input: Diagnostic text and optional known secret values.
 * Output: A safe single line of at most MAX_LOG_MESSAGE_LENGTH characters.
 * Use case: Shared authentication, provisioning and database pool log boundaries.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export function sanitizeLogMessage(text: string, secrets: readonly string[] = []): string {
  let result = redactLogCredentials(text, secrets);
  // Flatten log-injection controls only after recognizing line-based headers.
  result = result.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim();
  return result.length > MAX_LOG_MESSAGE_LENGTH
    ? `${result.slice(0, MAX_LOG_MESSAGE_LENGTH - 1)}…`
    : result;
}

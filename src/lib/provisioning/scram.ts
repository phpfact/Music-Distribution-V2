import "server-only";
/**
 * SCRAM-SHA-256 password verifiers in PostgreSQL's stored format
 * (docs/tenant-management.md §6.1, RFC 5802 / RFC 7677).
 *
 * `CREATE ROLE ... PASSWORD '<verifier>'` stores a verifier as is. Sending
 * the verifier instead of the password keeps the plaintext out of the server
 * log, which records statements.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

const DEFAULT_ITERATIONS = 4096; // PostgreSQL's scram_iterations default
const SALT_BYTES = 16; // what PostgreSQL itself generates
const KEY_BYTES = 32;

// PostgreSQL runs the password through SASLprep before hashing. For printable
// ASCII (0x20–0x7E) SASLprep changes nothing; implementing it in full would
// need Unicode normalization tables. So anything else is refused rather than
// risking a verifier that never matches. Our own rules only allow 0x21–0x7E.
const SASLPREP_IDENTITY = /^[\x20-\x7e]*$/;

/**
 * Description: Compute an HMAC-SHA-256.
 * Input: The key and the text.
 * Output: The digest bytes.
 * Use case: scramSha256Verifier.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function hmac(key: Buffer, text: string): Buffer {
  return createHmac("sha256", key).update(text).digest();
}

/**
 * Description: Compute a PostgreSQL SCRAM-SHA-256 password verifier.
 * Input: The password (printable ASCII) and optional iterations/salt (tests).
 * Output: `SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>` (base64);
 *   throws RangeError for a password outside printable ASCII.
 * Use case: passwordClause, so plaintext passwords never reach the server log.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function scramSha256Verifier(
  password: string,
  options: { iterations?: number; salt?: Buffer } = {},
): string {
  if (!SASLPREP_IDENTITY.test(password)) {
    throw new RangeError("SCRAM verifiers are only computed for printable ASCII passwords");
  }
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const salt       = options.salt ?? randomBytes(SALT_BYTES);

  const saltedPassword = pbkdf2Sync(password, salt, iterations, KEY_BYTES, "sha256");
  const clientKey      = hmac(saltedPassword, "Client Key");
  const storedKey      = createHash("sha256").update(clientKey).digest();
  const serverKey      = hmac(saltedPassword, "Server Key");

  return (
    `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}` +
    `$${storedKey.toString("base64")}:${serverKey.toString("base64")}`
  );
}
